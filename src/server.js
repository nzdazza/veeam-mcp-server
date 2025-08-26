// src/server.js
// MCP server exposing read-only tools for Veeam v8.1 REST API
// Transport: stdio (default) or SSE (--sse)
// Auth: username+password -> OAuth2 /api/v3/token with refresh token support

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import http from "node:http";
import { TextDecoder } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { fetch } from "undici";
import { z } from "zod";

const PKG_NAME = "veeam-mcp-server";
const VERSION = "0.1.1";

// --------- Config ---------
const BASE_URL   = process.env.VEEAM_BASE || "https://veeam.example.local";
const V_USER     = process.env.VEEAM_USER || "";
const V_PASS     = process.env.VEEAM_PASS || "";
const PORT       = parseInt(process.env.PORT || "3000", 10);

// Global response size guardrails
const MAX_BYTES   = 1_000_000; // ~1MB of JSON stringified payload
const MAX_ITEMS   = 1000;      // max top-level items aggregated when paginating

// Common input schema for list_* tools (Zod)
const listInputSchema = z.object({
  offset: z.number().int().min(0).optional().describe("Result offset (>=0)"),
  limit: z.number().int().min(1).max(100).optional().describe("Page size (1-100)"),
  filter: z.string().optional().describe("Filter expression (API-specific)"),
  sort: z.string().optional().describe("Sort expression (API-specific)"),
  search: z.string().optional().describe("Search term"),
  all: z.boolean().optional().describe("Fetch all pages automatically")
}).strict();

// --------- Minimal Veeam API client with token refresh ---------
class VeeamClient {
  constructor({ baseUrl, username, password }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.username = username;
    this.password = password;
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = 0;
  }

  async ensureToken() {
    const now = Date.now();
    // refresh if expiring in next 30s
    if (this.accessToken && now < (this.expiresAt - 30_000)) return;

    if (this.refreshToken) {
      const ok = await this.refresh();
      if (ok) return;
    }
    await this.login();
  }

  async login() {
    const url = `${this.baseUrl}/api/v3/token`;
    const body = new URLSearchParams({
      grant_type: "password",
      username: this.username,
      password: this.password
    }).toString();

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body
    });

    if (!res.ok) {
      const text = await res.text().catch(()=>"");
      throw new Error(`Veeam auth failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token || this.refreshToken;
    const expiresIn = Number(data.expires_in || 0);
    this.expiresAt = Date.now() + (isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 10 * 60 * 1000);
  }

  async refresh() {
    const url = `${this.baseUrl}/api/v3/token`;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken
    }).toString();

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body
    });

    if (!res.ok) {
      return false;
    }
    const data = await res.json();
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token || this.refreshToken;
    const expiresIn = Number(data.expires_in || 0);
    this.expiresAt = Date.now() + (isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 10 * 60 * 1000);
    return true;
  }

  // Build URL with optional query params
  buildUrl(path, query = {}) {
    const url = new URL(path.replace(/^\//, ""), this.baseUrl + "/");
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    });
    return url.toString();
  }

  // Core GET helper with 401 retry once
  async get(path, { query = {}, headers = {} } = {}) {
    await this.ensureToken();
    const url = this.buildUrl(path, query);
    let res = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${this.accessToken}`,
        ...headers
      }
    });
    if (res.status === 401) {
      // try refresh once
      await this.refresh().catch(()=>{});
      if (this.accessToken) {
        res = await fetch(url, {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "Authorization": `Bearer ${this.accessToken}`,
            ...headers
          }
        });
      }
    }
    if (!res.ok) {
      const text = await res.text().catch(()=>"");
      throw new Error(`Veeam GET ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  // Automatic pagination if all=true; tries "items" or "data" arrays; else returns single page
  async getList(path, params = {}) {
    const { all = false, offset = 0, limit = 100, filter, sort, search } = params;
    const qp = { offset, limit, filter, sort, search };
    if (!all) {
      return this.get(path, { query: qp });
    }
    let acc = [];
    let currentOffset = offset || 0;
    const pageLimit = Math.min(Math.max(1, limit || 100), 100);
    for (;;) {
      const page = await this.get(path, { query: { ...qp, offset: currentOffset, limit: pageLimit } });
      // detect array
      let items = Array.isArray(page) ? page
                 : Array.isArray(page.items) ? page.items
                 : Array.isArray(page.data) ? page.data
                 : null;
      if (!items) {
        // Unknown shape, just return the first page
        return page;
      }
      acc.push(...items);
      if (acc.length >= MAX_ITEMS || items.length < pageLimit) break;
      currentOffset += pageLimit;
      // be kind to API
      await delay(50);
    }
    return acc.slice(0, MAX_ITEMS);
  }
}

// --------- Utility: truncate payloads ---------
function truncatePayload(payload) {
  // Cut off extremely large responses for safety
  const asText = safeStringify(payload);
  if (asText.length <= MAX_BYTES) {
    return { payload, truncated: false, note: null };
  }
  // Attempt to truncate arrays commonly used
  let truncatedPayload = payload;
  let truncated = true;
  let note = `Response truncated to guardrail limits (~${Math.round(MAX_BYTES/1024)}KB).`;

  if (Array.isArray(payload)) {
    truncatedPayload = payload.slice(0, Math.min(payload.length, MAX_ITEMS));
  } else if (payload && typeof payload === "object") {
    if (Array.isArray(payload.items)) {
      truncatedPayload = { ...payload, items: payload.items.slice(0, Math.min(payload.items.length, MAX_ITEMS)) };
    } else if (Array.isArray(payload.data)) {
      truncatedPayload = { ...payload, data: payload.data.slice(0, Math.min(payload.data.length, MAX_ITEMS)) };
    } else {
      // Fallback: keep only first-level keys
      const keys = Object.keys(payload).slice(0, 50);
      truncatedPayload = {};
      for (const k of keys) truncatedPayload[k] = payload[k];
    }
  } else if (typeof payload === "string") {
    truncatedPayload = payload.slice(0, MAX_BYTES);
  }
  return { payload: truncatedPayload, truncated, note };
}

function safeStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

// --------- Tool registration helper ---------
function toolResult(obj, note) {
  const parts = [];
  if (note) parts.push(`NOTE: ${note}`);
  parts.push(safeStringify(obj));
  return {
    content: [{ type: "text", text: parts.join("\n") }]
  };
}

// --------- Build server and tools ---------
const server = new McpServer({
  name: PKG_NAME,
  version: VERSION,
});

const veeam = new VeeamClient({ baseUrl: BASE_URL, username: V_USER, password: V_PASS });

// Map of tool definitions to endpoint paths and whether they are "get by id"
const endpoints = {
  // Infrastructure
  list_tenants:                    { path: "/api/v3/tenants", list: true, title: "List Tenants" },
  list_backup_servers:             { path: "/api/v3/infrastructure/backupServers", list: true, title: "List Backup Servers" },
  list_jobs:                       { path: "/api/v3/jobs", list: true, title: "List Jobs" },

  // Protected VMs
  list_protected_vms:              { path: "/api/v8/protectedItem/virtualMachines", list: true, title: "List Protected VMs" },
  get_vm_details:                  { path: "/api/v8/protectedItem/virtualMachines/{id}", list: false, idParam: "id", title: "Get VM Details" },

  // Storage
  list_repositories:               { path: "/api/v3/repositories", list: true, title: "List Repositories" },
  get_repository:                  { path: "/api/v3/repositories/{id}", list: false, idParam: "id", title: "Get Repository" },

  list_sobr:                       { path: "/api/v3/backupInfrastructure/sobr", list: true, title: "List Scale-Out Backup Repositories (SOBR)" },
  get_sobr:                        { path: "/api/v3/backupInfrastructure/sobr/{id}", list: false, idParam: "id", title: "Get SOBR" },
  list_sobr_extents:               { path: "/api/v3/backupInfrastructure/sobr/{id}/extents", list: true, requireId: true, idParam: "id", title: "List SOBR Extents" },

  list_object_storage:             { path: "/api/v3/objectStorage", list: true, title: "List Object Storage" },
  get_object_storage:              { path: "/api/v3/objectStorage/{id}", list: false, idParam: "id", title: "Get Object Storage" },

  list_storage_systems:            { path: "/api/v3/storageSystems", list: true, title: "List Storage Systems" },
  get_storage_system:              { path: "/api/v3/storageSystems/{id}", list: false, idParam: "id", title: "Get Storage System" },
};

// Register tools
for (const [name, cfg] of Object.entries(endpoints)) {
  if (cfg.list) {
    server.registerTool(name, {
      title: cfg.title,
      description: `Read-only wrapper for GET ${cfg.path}`,
      inputSchema: listInputSchema
    }, async (args = {}) => {
      const parsed = listInputSchema.parse(args || {});
      const data = await veeam.getList(cfg.path, parsed);
      const { payload, truncated, note } = truncatePayload(data);
      return toolResult(payload, truncated ? note : undefined);
    });
  } else {
    // get-by-id style
    const schema = z.object({
      [cfg.idParam || "id"]: z.string().describe("Resource ID (GUID/identifier)")
    }).strict();
    server.registerTool(name, {
      title: cfg.title,
      description: `Read-only wrapper for GET ${cfg.path}`,
      inputSchema: schema
    }, async (args) => {
      const parsed = schema.parse(args || {});
      const idParam = cfg.idParam || "id";
      const id = parsed[idParam];
      const path = cfg.path.replace("{id}", encodeURIComponent(String(id)));
      const data = await veeam.get(path, {});
      const { payload, truncated, note } = truncatePayload(data);
      return toolResult(payload, truncated ? note : undefined);
    });
  }
}

// --------- Transport bootstrap ---------
async function start() {
  const useSse = process.argv.includes("--sse");
  if (useSse) {
    // Minimal SSE server using Node's http
    const transports = new Map(); // sessionId -> transport

    const serverHttp = http.createServer(async (req, res) => {
      try {
        if (req.method === "GET" && req.url?.startsWith("/sse")) {
          // Initiate SSE (legacy transport)
          const transport = new SSEServerTransport("/messages", res);
          transports.set(transport.sessionId, transport);
          res.on("close", () => transports.delete(transport.sessionId));

          await server.connect(transport);
          return;
        }

        if (req.method === "POST" && req.url?.startsWith("/messages")) {
          // Handle client->server POST messages
          const u = new URL(req.url, `http://${req.headers.host}`);
          const sessionId = u.searchParams.get("sessionId");
          const t = sessionId ? transports.get(sessionId) : null;
          if (!t) {
            res.statusCode = 400;
            res.end("No transport found for sessionId");
            return;
          }

          // Collect body
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const raw = Buffer.concat(chunks);
          const decoder = new TextDecoder("utf-8");
          const bodyText = decoder.decode(raw);
          const body = bodyText ? JSON.parse(bodyText) : {};

          await t.handlePostMessage(req, res, body);
          return;
        }

        // Health/info
        if (req.method === "GET" && (req.url === "/" || req.url?.startsWith("/health"))) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ name: PKG_NAME, version: VERSION, transport: "sse", now: new Date().toISOString() }));
          return;
        }

        res.statusCode = 404;
        res.end("Not Found");
      } catch (err) {
        res.statusCode = 500;
        res.end(String(err?.message || err));
      }
    });

    serverHttp.listen(PORT, () => {
      console.error(`[${PKG_NAME}] SSE server listening on http://localhost:${PORT}  (GET /sse, POST /messages)`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

start().catch((err) => {
  console.error(`[${PKG_NAME}] Fatal:`, err);
  process.exit(1);
});

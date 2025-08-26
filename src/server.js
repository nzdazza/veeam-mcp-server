// src/server.js
// Veeam v8.1 MCP server (read‑only). Hybrid QUIET build with SDK API polyfills.
// - Quiet by default (use --verbose or QUIET=0 to see info logs)
// - Works whether SDK exposes Server.addTool or McpServer.registerTool
// - Transports: stdio (default) or --sse

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import * as NewApi from "@modelcontextprotocol/sdk/server/index.js"; // may export Server
import * as OldApi from "@modelcontextprotocol/sdk/server/mcp.js";   // may export McpServer
import { z } from "zod";
import http from "node:http";
import { TextDecoder } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { fetch } from "undici";

const PKG_NAME = "veeam-mcp-server";
const VERSION = "0.1.7";

// ---------- Logging control ----------
const QUIET = process.argv.includes("--quiet") || (!process.argv.includes("--verbose") && process.env.QUIET !== "0");
const logInfo = (...a) => { if (!QUIET) console.error(...a); };
const logErr  = (...a) => { console.error(...a); };

// ---------- Config ----------
const BASE_URL = process.env.VEEAM_BASE || "https://veeam.example.local";
const V_USER   = process.env.VEEAM_USER || "";
const V_PASS   = process.env.VEEAM_PASS || "";
const PORT     = parseInt(process.env.PORT || "3000", 10);

// Guardrails
const MAX_BYTES = 1_000_000;
const MAX_ITEMS = 1000;

// ---------- Schemas ----------
const listInputSchema = z.object({
  offset: z.number().int().min(0).optional().describe(">=0"),
  limit:  z.number().int().min(1).max(100).optional().describe("1-100"),
  filter: z.string().optional(),
  sort:   z.string().optional(),
  search: z.string().optional(),
  all:    z.boolean().optional().describe("Fetch all pages automatically")
}).strict();

// ---------- HTTP client with OAuth2 + refresh ----------
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
    if (this.accessToken && now < this.expiresAt - 30_000) return;
    if (this.refreshToken && await this.refresh()) return;
    await this.login();
  }
  async login() {
    const res = await fetch(`${this.baseUrl}/api/v3/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: new URLSearchParams({ grant_type: "password", username: this.username, password: this.password }).toString()
    });
    if (!res.ok) throw new Error(`Auth failed ${res.status}: ${await res.text().catch(()=> "")}`);
    const d = await res.json();
    this.accessToken = d.access_token;
    this.refreshToken = d.refresh_token || this.refreshToken;
    const expiresIn = Number(d.expires_in || 600);
    this.expiresAt = Date.now() + expiresIn * 1000;
  }
  async refresh() {
    const res = await fetch(`${this.baseUrl}/api/v3/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.refreshToken }).toString()
    });
    if (!res.ok) return false;
    const d = await res.json();
    this.accessToken = d.access_token;
    this.refreshToken = d.refresh_token || this.refreshToken;
    const expiresIn = Number(d.expires_in || 600);
    this.expiresAt = Date.now() + expiresIn * 1000;
    return true;
  }
  buildUrl(path, query = {}) {
    const u = new URL(path.replace(/^\//, ""), this.baseUrl + "/");
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
    return u.toString();
  }
  async get(path, { query = {}, headers = {} } = {}) {
    await this.ensureToken();
    const url = this.buildUrl(path, query);
    let res = await fetch(url, { method: "GET", headers: { "Accept": "application/json", "Authorization": `Bearer ${this.accessToken}`, ...headers } });
    if (res.status === 401 && (await this.refresh())) {
      res = await fetch(url, { method: "GET", headers: { "Accept": "application/json", "Authorization": `Bearer ${this.accessToken}`, ...headers } });
    }
    if (!res.ok) throw new Error(`GET ${path} ${res.status}: ${await res.text().catch(()=> "")}`);
    return res.json();
  }
  async getList(path, params = {}) {
    const { all = false, offset = 0, limit = 100, filter, sort, search } = params;
    const qp = { offset, limit, filter, sort, search };
    if (!all) return this.get(path, { query: qp });
    const acc = [];
    let off = offset || 0;
    const page = Math.min(Math.max(1, limit || 100), 100);
    for (;;) {
      const data = await this.get(path, { query: { ...qp, offset: off, limit: page } });
      const items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : Array.isArray(data.data) ? data.data : null;
      if (!items) return data;
      acc.push(...items);
      if (acc.length >= MAX_ITEMS || items.length < page) break;
      off += page;
      await delay(50);
    }
    return acc.slice(0, MAX_ITEMS);
  }
}

// ---------- Utils ----------
const safeStringify = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };
function truncatePayload(payload) {
  const s = safeStringify(payload);
  if (s.length <= MAX_BYTES) return { payload, note: null };
  let out = payload;
  if (Array.isArray(payload)) out = payload.slice(0, MAX_ITEMS);
  else if (payload && typeof payload === "object") {
    if (Array.isArray(payload.items)) out = { ...payload, items: payload.items.slice(0, MAX_ITEMS) };
    else if (Array.isArray(payload.data)) out = { ...payload, data: payload.data.slice(0, MAX_ITEMS) };
    else { const keys = Object.keys(payload).slice(0, 50); out = {}; for (const k of keys) out[k] = payload[k]; }
  } else if (typeof payload === "string") out = payload.slice(0, MAX_BYTES);
  return { payload: out, note: `Response truncated (~${Math.round(MAX_BYTES/1024)}KB guardrail).` };
}
const toolResult = (obj, note) => ({ content: [{ type: "text", text: (note ? `NOTE: ${note}\n` : "") + safeStringify(obj) }] });

// ---------- Server (hybrid + polyfills) ----------
const NewServer = NewApi.Server;
const OldServer = OldApi.McpServer;
const server = NewServer ? new NewServer({ name: PKG_NAME, version: VERSION })
                         : new OldServer({ name: PKG_NAME, version: VERSION });

// Polyfill whichever API surface is missing so we can always call server.addTool()
if (typeof server.addTool !== "function" && typeof server.registerTool === "function") {
  // Old -> New
  server.addTool = ({ name, description, inputSchema }, handler) =>
    server.registerTool(name, { title: name, description, inputSchema }, handler);
}
if (typeof server.registerTool !== "function" && typeof server.addTool === "function") {
  // New -> Old (polyfill to avoid client code that calls registerTool)
  server.registerTool = (name, meta, handler) =>
    server.addTool({ name, description: meta?.description, inputSchema: meta?.inputSchema }, handler);
}

// ---------- Define tools (always via addTool) ----------
const veeam = new VeeamClient({ baseUrl: BASE_URL, username: V_USER, password: V_PASS });

const endpoints = {
  // Infrastructure
  list_tenants:          { path: "/api/v3/tenants", list: true,  title: "List Tenants" },
  list_backup_servers:   { path: "/api/v3/infrastructure/backupServers", list: true, title: "List Backup Servers" },
  list_jobs:             { path: "/api/v3/jobs", list: true, title: "List Jobs" },
  // Protected VMs
  list_protected_vms:    { path: "/api/v8/protectedItem/virtualMachines", list: true, title: "List Protected VMs" },
  get_vm_details:        { path: "/api/v8/protectedItem/virtualMachines/{id}", list: false, idParam: "id", title: "Get VM Details" },
  // Storage
  list_repositories:     { path: "/api/v3/repositories", list: true, title: "List Repositories" },
  get_repository:        { path: "/api/v3/repositories/{id}", list: false, idParam: "id", title: "Get Repository" },
  list_sobr:             { path: "/api/v3/backupInfrastructure/sobr", list: true, title: "List SOBR" },
  get_sobr:              { path: "/api/v3/backupInfrastructure/sobr/{id}", list: false, idParam: "id", title: "Get SOBR" },
  list_sobr_extents:     { path: "/api/v3/backupInfrastructure/sobr/{id}/extents", list: true, idParam: "id", requireId: true, title: "List SOBR Extents" },
  list_object_storage:   { path: "/api/v3/objectStorage", list: true, title: "List Object Storage" },
  get_object_storage:    { path: "/api/v3/objectStorage/{id}", list: false, idParam: "id", title: "Get Object Storage" },
  list_storage_systems:  { path: "/api/v3/storageSystems", list: true, title: "List Storage Systems" },
  get_storage_system:    { path: "/api/v3/storageSystems/{id}", list: false, idParam: "id", title: "Get Storage System" },
};

const registered = [];
for (const [name, cfg] of Object.entries(endpoints)) {
  if (cfg.list) {
    server.addTool(
      { name, description: `Read-only GET ${cfg.path}`, inputSchema: listInputSchema },
      async (args = {}) => {
        const params = listInputSchema.parse(args || {});
        const data = await veeam.getList(cfg.path, params);
        const { payload, note } = truncatePayload(data);
        return toolResult(payload, note);
      }
    );
  } else {
    const byId = z.object({ [cfg.idParam || "id"]: z.string().describe("Resource ID") }).strict();
    server.addTool(
      { name, description: `Read-only GET ${cfg.path}`, inputSchema: byId },
      async (args = {}) => {
        const parsed = byId.parse(args || {});
        const id = parsed[cfg.idParam || "id"];
        const path = cfg.path.replace("{id}", encodeURIComponent(String(id)));
        const data = await veeam.get(path, {});
        const { payload, note } = truncatePayload(data);
        return toolResult(payload, note);
      }
    );
  }
  registered.push(name);
}

// ---------- Transport bootstrap ----------
async function start() {
  const useSse = process.argv.includes("--sse");
  if (useSse) {
    const transports = new Map();
    const httpServer = http.createServer(async (req, res) => {
      try {
        if (req.method === "GET" && req.url?.startsWith("/sse")) {
          const transport = new SSEServerTransport("/messages", res);
          transports.set(transport.sessionId, transport);
          res.on("close", () => transports.delete(transport.sessionId));
          logInfo(`[${PKG_NAME}] SSE connected. Tools: ${registered.length}`);
          await server.connect(transport);
          return;
        }
        if (req.method === "POST" && req.url?.startsWith("/messages")) {
          const u = new URL(req.url, `http://${req.headers.host}`);
          const sessionId = u.searchParams.get("sessionId");
          const t = sessionId ? transports.get(sessionId) : null;
          if (!t) { res.statusCode = 400; res.end("No transport for sessionId"); return; }
          const chunks = []; for await (const c of req) chunks.push(c);
          const raw = Buffer.concat(chunks);
          const bodyText = raw.length ? new TextDecoder("utf-8").decode(raw) : "";
          await t.handlePostMessage(req, res, bodyText ? JSON.parse(bodyText) : {});
          return;
        }
        if (req.method === "GET" && (req.url === "/" || req.url?.startsWith("/health"))) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ name: PKG_NAME, version: VERSION, transport: "sse", tools: registered, now: new Date().toISOString() }));
          return;
        }
        res.statusCode = 404; res.end("Not Found");
      } catch (e) { res.statusCode = 500; res.end(String(e?.message || e)); }
    });
    httpServer.listen(PORT, () => logInfo(`[${PKG_NAME}] SSE listening on http://localhost:${PORT} (GET /sse, POST /messages). Tools: ${registered.length}`));
  } else {
    const transport = new StdioServerTransport();
    logInfo(`[${PKG_NAME}] stdio started. Tools: ${registered.length}`);
    await server.connect(transport);
  }
}

start().catch(err => { logErr(`[${PKG_NAME}] Fatal:`, err); process.exit(1); });

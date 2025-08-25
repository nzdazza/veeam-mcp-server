# veeam-mcp-server

Model Context Protocol (MCP) server for **Veeam v8.1 REST API** (read-only).  
Supports **stdio** (default) and **SSE** (`--sse`) transports.

> **Tools are strictly read-only.** No write operations are implemented.

## Features

- Username + password → OAuth2 `/api/v3/token` (with **refresh token** support)
- **Tools (read-only):**
  - **Infrastructure**
    - `list_tenants` → GET `/api/v3/tenants`
    - `list_backup_servers` → GET `/api/v3/infrastructure/backupServers`
    - `list_jobs` → GET `/api/v3/jobs`
  - **Protected VMs**
    - `list_protected_vms` → GET `/api/v8/protectedItem/virtualMachines`
    - `get_vm_details` → GET `/api/v8/protectedItem/virtualMachines/{id}`
  - **Storage**
    - `list_repositories` → GET `/api/v3/repositories`
    - `get_repository` → GET `/api/v3/repositories/{id}`
    - `list_sobr` → GET `/api/v3/backupInfrastructure/sobr`
    - `get_sobr` → GET `/api/v3/backupInfrastructure/sobr/{id}`
    - `list_sobr_extents` → GET `/api/v3/backupInfrastructure/sobr/{id}/extents`
    - `list_object_storage` → GET `/api/v3/objectStorage`
    - `get_object_storage` → GET `/api/v3/objectStorage/{id}`
    - `list_storage_systems` → GET `/api/v3/storageSystems`
    - `get_storage_system` → GET `/api/v3/storageSystems/{id}`
- **Input schema** for all `list_*` tools:
  ```json
  {
    "offset": "integer >=0",
    "limit": "integer 1-100",
    "filter": "string",
    "sort": "string",
    "search": "string",
    "all": "boolean (fetch all pages automatically)"
  }
  ```
- **Automatic pagination** when `all: true`
- **Payload truncation guardrail**: large responses are cut off (~1MB / 1000 items) and annotated
- **Stable, human-friendly tool names**
- **No write operations**

## Requirements

- Node.js **20.10.0+**
- Veeam Backup REST API base URL and credentials

## Install

### Local (repo)
```bash
npm install
npm start
```

### npx (no install) via GitHub
```bash
npx github:nzdazza/veeam-mcp-server
```

### Global install from GitHub
```bash
npm i -g "git+https://github.com/nzdazza/veeam-mcp-server.git"
veeam-mcp-server
```

## Usage

**Default (stdio):**
```bash
# environment (adjust to your Veeam)
export VEEAM_BASE="https://veeam.example.local"
export VEEAM_USER="veeam-username"
export VEEAM_PASS="veeam-password"

# start stdio MCP server
npm start
# or, if installed globally:
veeam-mcp-server
# or via npx GitHub shortcut:
npx github:nzdazza/veeam-mcp-server
```

**SSE transport (HTTP + SSE, legacy):**
```bash
# listen on PORT (default 3000)
export PORT=3000
node src/server.js --sse
# or:
npm run start:sse

# Endpoints:
#   GET  /sse          -> establishes SSE stream
#   POST /messages     -> client->server messages (requires ?sessionId=...)
```

> The SSE transport is provided for compatibility with older clients. The default is stdio.

## Configuration (env vars)

- `VEEAM_BASE` – Base URL of the Veeam REST API (e.g. `https://veeam.example.local`)
- `VEEAM_USER` – Username for OAuth2 password grant
- `VEEAM_PASS` – Password for OAuth2 password grant
- `PORT` – HTTP port for `--sse` mode (default `3000`)

## Development

- ESM modules, Node 20+
- Dependencies: `@modelcontextprotocol/sdk`, `undici`
- Scripts:
  - `npm start` – stdio transport
  - `npm run start:sse` – SSE transport

## License

MIT – see [LICENSE](./LICENSE).

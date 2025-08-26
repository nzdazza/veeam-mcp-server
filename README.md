# veeam-mcp-server

Model Context Protocol (MCP) server for **Veeam v8.1 REST API** (read-only).  
Supports **stdio** (default) and **SSE** (`--sse`) transports.

> **Tools are strictly read-only.** No write operations are implemented.

## Fix for `keyValidator._parse`
This build defines tool schemas with **Zod** and adds `zod` as a dependency, which resolves the `keyValidator._parse is not a function` error that occurs when plain JSON Schema objects are passed to older MCP SDK validators.

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
- **Input schema** for all `list_*` tools (Zod):
  ```ts
  z.object({
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    filter: z.string().optional(),
    sort: z.string().optional(),
    search: z.string().optional(),
    all: z.boolean().optional(),
  }).strict()
  ```
- **Automatic pagination** when `all: true`
- **Payload truncation guardrail** (~1MB / 1000 items)
- **Stable, human-friendly tool names**
- **No write operations**

## Requirements

- Node.js **20.10.0+**
- Veeam Backup REST API base URL and credentials

## Install / Run

```bash
npm install
npm start            # stdio
npm run start:sse    # SSE on PORT (default 3000)
```

## Env Vars

- `VEEAM_BASE`, `VEEAM_USER`, `VEEAM_PASS`, `PORT`

## License

MIT – see [LICENSE](./LICENSE).

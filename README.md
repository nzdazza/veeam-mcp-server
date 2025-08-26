# veeam-mcp-server

MCP server for **Veeam v8.1 REST API** (read-only).  
**Locked to `McpServer.registerTool`** for maximum client compatibility (RooCode, Inspector, Copilot).  
Transports: **stdio** (default) and **SSE** (`--sse`).

## Tools
Infrastructure: `list_tenants`, `list_backup_servers`, `list_jobs`  
Protected VMs: `list_protected_vms`, `get_vm_details`  
Storage: `list_repositories`, `get_repository`, `list_sobr`, `get_sobr`, `list_sobr_extents`, `list_object_storage`, `get_object_storage`, `list_storage_systems`, `get_storage_system`

## Run
```bash
npm install
npm start            # stdio (preferred for RooCode)
npm run start:sse    # SSE on PORT (default 3000)
```

Env: `VEEAM_BASE`, `VEEAM_USER`, `VEEAM_PASS`, `PORT`

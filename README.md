# veeam-mcp-server

Model Context Protocol (MCP) server for **Veeam v8.1 REST API** (read-only).  
**Works with both old and new MCP SDKs** (uses a compatibility wrapper).  
Transports: **stdio** (default) and **SSE** (`--sse`).

## Tools
Infrastructure: `list_tenants`, `list_backup_servers`, `list_jobs`  
Protected VMs: `list_protected_vms`, `get_vm_details`  
Storage: `list_repositories`, `get_repository`, `list_sobr`, `get_sobr`, `list_sobr_extents`, `list_object_storage`, `get_object_storage`, `list_storage_systems`, `get_storage_system`

## Install / Run
```bash
npm install
npm start            # stdio (preferred for RooCode)
npm run start:sse    # SSE on PORT (default 3000)
```

### Env
`VEEAM_BASE`, `VEEAM_USER`, `VEEAM_PASS`, `PORT`

### RooCode `mcp.json` (Windows)
```json
{
  "mcpServers": {
    "veeam": {
      "command": "node",
      "args": ["C:\\\\path\\\\to\\\\veeam-mcp-server\\\\src\\\\server.js"],
      "env": {
        "VEEAM_BASE": "https://your-veeam.example.local",
        "VEEAM_USER": "your-user",
        "VEEAM_PASS": "your-pass"
      }
    }
  }
}
```

## License
MIT

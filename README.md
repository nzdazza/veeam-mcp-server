# veeam-mcp-server (portable)

- Uses the **top-level** `@modelcontextprotocol/sdk` entry only (no deep subpath imports)
- Quiet by default (use `--verbose` or `QUIET=0` for logs)
- 14 read-only tools for Veeam v8.1
- stdio (default) and SSE (`--sse`) transports

## Run
```bash
npm install
node src/server.js          # stdio
node src/server.js --sse    # SSE on PORT (default 3000)
# verbose logging:
node src/server.js --verbose
# or QUIET=0 node src/server.js
```
Env: `VEEAM_BASE`, `VEEAM_USER`, `VEEAM_PASS`, `PORT`.

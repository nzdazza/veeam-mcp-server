# veeam-mcp-server (quiet build)

- Quiet-by-default (no info logs unless you pass `--verbose` or `QUIET=0`)
- Transports: stdio (default), SSE (`--sse`)
- Tools: 14 read-only endpoints for Veeam v8.1
- Auth: username+password -> OAuth2 `/api/v3/token` with refresh

## Run
```bash
npm install
# stdio
node src/server.js
# verbose mode (show startup info)
node src/server.js --verbose
# or
QUIET=0 node src/server.js
```

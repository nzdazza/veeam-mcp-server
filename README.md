# veeam-mcp-server (hybrid-quiet)

- Quiet by default (pass `--verbose` or `QUIET=0` to see info logs)
- Polyfills MCP SDK APIs so **both** styles work:
  - `Server.addTool(...)`
  - `McpServer.registerTool(...)`
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

Set env: `VEEAM_BASE`, `VEEAM_USER`, `VEEAM_PASS`, `PORT`.

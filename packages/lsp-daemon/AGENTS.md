# lsp-daemon — Shared Per-User LSP Daemon

**Generated:** 2026-06-11

## OVERVIEW

Vendored, Node-targeted MCP-layer package (`@code-yeongyu/lsp-daemon`). Runs ONE long-lived LSP process per user and fans many short-lived agent sessions into it over a unix socket (Windows named pipe). Built for the **Codex** edition where every tool call spawns a fresh process: instead of cold-starting a language server each time, sessions launch a thin stdio MCP **proxy** that forwards to the warm **daemon**. Reuses [`@code-yeongyu/lsp-tools-mcp`](../lsp-tools-mcp) for the actual LSP manager + MCP request handler — this package only adds the daemon/proxy/transport layer. Built with `npm` + vitest + biome (NOT Bun); `engines.node >= 20`.

## KEY FILES

| File | Role |
|------|------|
| `cli.ts` | Bin `omo-lsp-daemon`. `mcp` (default) → `runMcpStdioProxy()`; `daemon` → `runDaemon()` |
| `proxy.ts` | `runMcpStdioProxy()` — reads JSON-RPC lines from stdin; `tools/call` → daemon via client; other LSP MCP requests handled locally |
| `daemon-server.ts` | `startDaemonServer()` — `net.createServer` on the socket, owns the LSP manager, idle auto-shutdown, pid/endpoint files, SIGTERM/SIGINT cleanup |
| `daemon-client.ts` | `callToolViaDaemon()` / `callDiagnosticsViaDaemon()` — connect to socket, send tool call, await response |
| `ensure-daemon.ts` | `ensureDaemonRunning()` — probe → lock → spawn detached daemon → poll until reachable (DI'd deps for tests) |
| `request-routing.ts` | `handleDaemonMessage()` — strips `_context` (cwd/env) from args, runs request inside that `RequestContext` |
| `paths.ts` | Versioned socket/lock/pid/log path resolution |
| `lock.ts` | Single-flight file lock + `unlinkQuietly` |
| `socket-jsonrpc.ts` | Newline-delimited JSON-RPC framing over the socket |
| `run-daemon.ts` | `daemon` subcommand entry (boots the server) |
| `index.ts` | Barrel: `runMcpStdioProxy`, `ensureDaemonRunning`, `callToolViaDaemon`, `callDiagnosticsViaDaemon`, `daemonPaths`, `disposeDefaultLspManager` |

## FLOW

```
session → omo-lsp-daemon (mcp proxy, stdio)
   ├─ ensureDaemonRunning(): probe socket
   │     ├─ reachable → reuse
   │     └─ down → tryAcquireLock → spawn detached `cli.js daemon` → poll until reachable
   ├─ tools/call (+ _context {cwd,env}) → daemon-client → unix socket
   │     └─ daemon: handleDaemonMessage → runWithRequestContext(cwd/env) → lsp-tools-mcp handler
   └─ non tool-call LSP MCP request → handled locally in the proxy
```

## NOTES

- **Per-request context threading:** the proxy injects `_context` (cwd + env allowlist) into each `tools/call`; the daemon runs that request inside `runWithRequestContext` so one shared process correctly serves many working directories.
- **Idle shutdown:** daemon self-exits after 30 min (`DEFAULT_IDLE_SHUTDOWN_MS`) once there are no live connections AND `getLspManager().clientCount() === 0`. Live LSP clients keep it warm.
- **Socket path:** `$CODEX_LSP_DAEMON_DIR` → else `$PLUGIN_DATA/daemon` → else `~/.codex/codex-lsp/daemon/`, all under a `v<version>` dir. Unix socket `daemon.sock`; falls back to a hashed `tmpdir()` path when the natural path exceeds 100 chars; Windows uses a `\\.\pipe\omo-lsp-*` named pipe.
- **Spawn is detached + log-redirected:** child runs `node cli.js daemon` with `stdio: ["ignore", logFd, logFd]` (→ `daemon.log`) and `unref()`, so the parent session never blocks on it.
- **Build before use:** `bun run build:lsp-daemon` (`npm ci` + `npm run build`) before anything needing `dist/`. Shipped via the root `package.json` `files` array (`packages/lsp-daemon/{package.json,dist}`).

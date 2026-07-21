# lsp-daemon -- Shared Per-User LSP Daemon

**Generated:** 2026-07-17 / 7d664b96b

## OVERVIEW

Vendored, Node-targeted MCP-layer package (`@code-yeongyu/lsp-daemon`). Runs ONE long-lived LSP process per user and fans many short-lived agent sessions into it over a unix socket (Windows named pipe). The runtime contract is harness-neutral so Codex, OpenCode, and Senpi can converge on the same authenticated daemon. Sessions launch a thin stdio MCP **proxy** that forwards to the warm **daemon**. Reuses [`@code-yeongyu/lsp-tools-mcp`](../lsp-tools-mcp) for the actual LSP manager + MCP request handler - this package only adds the daemon/proxy/transport layer. Built with `npm` + vitest + biome (NOT Bun); `engines.node >= 20`.

## KEY FILES

| File | Role |
|------|------|
| `cli.ts` | Bin `omo-lsp-daemon`. `mcp` (default) → `runMcpStdioProxy()`; `daemon` → `runDaemon()` |
| `proxy.ts` | `runMcpStdioProxy()`: reads JSON-RPC lines from stdin; `tools/call` → daemon via client; other LSP MCP requests handled locally; startup watchdog + aborts on stdin close |
| `daemon-server.ts` | `startDaemonServer()`: `net.createServer` on the socket, owns the LSP manager, idle auto-shutdown, pid/endpoint files, SIGTERM/SIGINT cleanup |
| `daemon-client.ts` | `callToolViaDaemon()` / `callDiagnosticsViaDaemon()`: connect to socket, send tool call, await response; honors `AbortSignal`, sends `$/cancelRequest` on abort/timeout |
| `ensure-daemon.ts` | `ensureDaemonRunning()`: probe → lock → spawn detached daemon → poll until reachable (DI'd deps for tests); accepts `AbortSignal`, abort cancels pending startup |
| `request-routing.ts` | `handleDaemonMessage()`: strips `_context` (cwd/env) from args, runs request inside that `RequestContext` |
| `runtime-contract.ts` | Exact three-variable runtime override contract + typed validation errors |
| `paths.ts` | OMO-owned versioned socket/lock/pid/log path resolution |
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

- **Startup watchdog:** the proxy exits if no MCP request arrives within `startupTimeoutMs` (default `DEFAULT_STARTUP_TIMEOUT_MS` = 10 s). The first handler invocation clears the watchdog; on expiry it destroys stdin and writes a `[lsp-daemon]` diagnostic to stderr, then swallows the resulting `ERR_STREAM_PREMATURE_CLOSE`.
- **Cancellation lifecycle:** the proxy owns an `AbortController` aborted on stdin `end`/`close`. That signal threads through `callToolViaDaemon` into `ensureDaemonAvailable` (rejects `DaemonRequestCancelledError`) and `sendToolCall`, which sends a `$/cancelRequest` (auth envelope + request id) to the daemon and rejects. `callToolViaDaemon` retries only on auth refresh; it breaks on `DaemonRequestCancelledError` and on a `DaemonRequestError` that was already written or names a non-retryable tool (`rename`/`lsp_rename`).
- **QA smoke scripts:** `scripts/qa/cancellation-smoke.mjs` drives one deterministic socket-to-LSP cancellation end-to-end; `scripts/qa/commit-barrier-smoke.mjs` proves an aborted `textDocument/rename` emits `$/cancelRequest` before any workspace edit applies (an abort mid-apply still commits exactly one edit, reported as a late abort). Both take the repo root as `argv[2]` and are wired into the codex-qa/opencode-qa `lsp-e2e.sh` drivers.
- **Per-request context threading:** the proxy injects `_context` (cwd + env allowlist) into each `tools/call`; the daemon runs that request inside `runWithRequestContext` so one shared process correctly serves many working directories.
- **Idle shutdown:** daemon self-exits after 30 min (`DEFAULT_IDLE_SHUTDOWN_MS`) once there are no live connections AND `getLspManager().clientCount() === 0`. Live LSP clients keep it warm.
- **State root:** `$OMO_LSP_DAEMON_DIR` when it is already absolute, otherwise `~/.omo/lsp-daemon`; every runtime is isolated under `v<version>`.
- **Runtime overrides are paired:** `$OMO_LSP_DAEMON_CLI` and `$OMO_LSP_DAEMON_VERSION` must be both absent or both present. A singleton pair fails before path creation or spawn. Explicit CLI paths must be absolute existing regular files; versions must match `[A-Za-z0-9][A-Za-z0-9._+-]{0,127}`.
- **Socket path:** Unix uses `<version-dir>/daemon.sock` and keeps the short hashed `tmpdir()` fallback when the natural path reaches 100 characters. Windows binds the pipe digest to the canonical version directory plus the current user discriminator; request authentication remains the security boundary.
- **OpenCode bootstrap:** dist/bootstrap resolves the package `./cli` export instead of deep-running generated files. Source mode runs the actual `src/cli.ts` with Bun and sets the paired `OMO_LSP_DAEMON_CLI`/`OMO_LSP_DAEMON_VERSION` override to that source CLI plus the package version. The OpenCode adapter supplies only the three `LSP_TOOLS_MCP_*` translator inputs for request context: `.opencode/lsp.json`, `.omo/lsp.json`, `.omo/lsp-client.json`, then the OpenCode user config and install-decision paths.
- **Legacy cleanup input:** `test/fixtures/legacy-path-vectors.json` freezes the pre-migration natural Unix, hashed Unix, and Windows named-pipe paths for the installer cleanup work. Do not regenerate those paths from the new resolver.
- **Clean builds:** `scripts/clean-dist.mjs` removes the complete old `dist` tree before TypeScript and Bun emit new artifacts, so deleted generated files cannot survive a build.
- **Spawn is detached + log-redirected:** child runs `node cli.js daemon` with `stdio: ["ignore", logFd, logFd]` (→ `daemon.log`) and `unref()`, so the parent session never blocks on it.
- **Build before use:** `bun run build:lsp-daemon` (`npm ci` + `npm run build`) before anything needing `dist/`. Shipped via the root `package.json` `files` array (`packages/lsp-daemon/{package.json,dist}`).

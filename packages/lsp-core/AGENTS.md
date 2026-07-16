# lsp-core — Harness-Neutral LSP Engine (Core)

**Generated:** 2026-06-16

## OVERVIEW

Harness-neutral LSP engine (`@oh-my-opencode/lsp-core`). Manages language server lifecycle, JSON-RPC transport, configuration merging, and tool definitions. Consumed by the MCP-layer packages [`lsp-tools-mcp`](../lsp-tools-mcp) and [`lsp-daemon`](../lsp-daemon/AGENTS.md). See parent [packages/AGENTS.md](../AGENTS.md).

## KEY FILES

| File | Role |
|------|------|
| `src/lsp/manager.ts` | `LspManager` — ref-counted client pool, init timeout, idle reaper, abort signals |
| `src/lsp/client.ts` | `LspClient` — `openFile`, `definition`, `references`, `symbols`, `diagnostics`, `rename` |
| `src/lsp/client-wrapper.ts` | `withLspClient()` — workspace root discovery, retry on dead connection, release |
| `src/lsp/connection.ts` | `LspClientConnection` — `initialize` request with capabilities, settle delay |
| `src/lsp/json-rpc-connection.ts` | Raw JSON-RPC 2.0 framing over stdio |
| `src/lsp/config-loader.ts` | Load `.codex/lsp-client.json` (project + user), merge with builtins |
| `src/lsp/server-definitions.ts` | `BUILTIN_SERVERS` (51 languages), `LSP_INSTALL_HINTS`, `AUTO_INSTALLABLE_SERVERS` |
| `src/lsp/server-resolution.ts` | `findServerForExtension()` — map extension to installed server |
| `src/lsp/server-installation.ts` | `isServerInstalled()` — PATH lookup with Windows extension handling |
| `src/lsp/directory-diagnostics.ts` | `aggregateDiagnosticsForDirectory()` — walk directory, cap files + diagnostics |
| `src/lsp/formatters.ts` | Format locations, symbols, diagnostics, rename results, workspace edits |
| `src/tools/definitions.ts` | `LSP_MCP_TOOLS` — 8 tool schemas exported to MCP |
| `src/tools/runtime.ts` | `executeLspTool()` + `coerceToolArguments()` dispatch |
| `src/request-context.ts` | `runWithRequestContext()` / `contextCwd()` / `contextEnv()` via `AsyncLocalStorage` |
| `src/mcp.ts` | `handleLspMcpRequest()` + `runMcpStdioServer()` — MCP entry over `mcp-stdio-core` |

## NOTES

- **Tool surface:** 8 tools: `lsp_diagnostics`, `lsp_goto_definition`, `lsp_find_references`, `lsp_symbols`, `lsp_prepare_rename`, `lsp_rename`, `lsp_status`, and `lsp_install_decision`.
- **RequestContext seam:** `request-context.ts` uses `AsyncLocalStorage` so the MCP proxy can thread `cwd` and `env` through shared daemon sessions.
- **Config priority:** project `.codex/lsp-client.json` beats user `~/.codex/lsp-client.json` beats `BUILTIN_SERVERS`.
- **Reaper:** `LspManager` reaps clients idle longer than `IDLE_TIMEOUT_MS` (default 5 min) or stuck initializing past `INIT_TIMEOUT_MS` (default 30 s).

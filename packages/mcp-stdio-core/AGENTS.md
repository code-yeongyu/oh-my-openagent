# mcp-stdio-core — JSON-RPC stdio Framing + Dispatch (Core)

**Generated:** 2026-06-17

## OVERVIEW

The lowest-level core package: JSON-RPC 2.0 transport over stdio (line-mode and Content-Length framed), an event-loop server with idle timeout, response builders, and an `isPlainRecord` guard. Zero runtime/peer dependencies — imports nothing from the workspace, consumed by every MCP-layer package. Package: `@oh-my-opencode/mcp-stdio-core`.

## KEY FILES (5 source, all flat in `src/`)

| File | Subpath export | Role |
|------|----------------|------|
| `types.ts` | `./types` | `JsonRpcId/Error/Result/Response`, `McpToolDescriptor`, `TextContent`, `McpLifecycleLog` |
| `record.ts` | `./record` | `isPlainRecord(value)` type guard |
| `responses.ts` | `./responses` | `successResponse`, `errorResponse`, `jsonRpcId`, `messageFromError` |
| `server.ts` | `./server` | `runJsonRpcStdioServer(config)` — async-generator loop, idle timeout, `McpRequestHandler` |
| `transport.ts` | `./transport` | `readStdioJsonRpcMessages` (async gen), `writeStdioJsonRpcResponse`, dual framing |

## CONSUMERS

- `lsp-core/src/mcp.ts` (primary) — LSP MCP server.
- `git-bash-mcp/src/mcp.ts` — Git Bash MCP server.
- `lsp-daemon/src/proxy.ts` — stdio MCP proxy (also imports the `./record` subpath).

## NOTES

- **Two framing modes:** `"line"` (`\n`-delimited) and `"framed"` (`Content-Length:` header per MCP spec); auto-detected by scanning the buffer prefix for `content-length:`.
- **Idle timeout uses `timer.unref()`** — the timeout never keeps the process alive.
- **Handler contract:** return `undefined` to skip silently; `onHandlerError` catches exceptions; `parseErrorResponse` customizes JSON parse errors.
- **Keep zero dependencies.** `.js` suffix on relative imports (ESM). This is the floor of the package layering — it must stay leaf.
- Parent: [`packages/AGENTS.md`](../AGENTS.md).

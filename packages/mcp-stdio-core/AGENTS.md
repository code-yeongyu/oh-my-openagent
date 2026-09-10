# mcp-stdio-core -- JSON-RPC stdio Framing + Dispatch (Core)

**Generated:** 2026-08-24 / f3642fcda

## OVERVIEW

The lowest-level core package: JSON-RPC 2.0 transport over stdio (line-mode and Content-Length framed), an event-loop server with idle timeout, response builders, and an `isPlainRecord` guard. Zero runtime/peer dependencies; imports nothing from the workspace, consumed by every MCP-layer package. Package: `@oh-my-opencode/mcp-stdio-core`.

## KEY FILES (5 source, all flat in `src/`)

| File | Subpath export | Role |
|------|----------------|------|
| `types.ts` | `./types` | `JsonRpcId/Error/Result/Response`, `McpToolDescriptor`, `TextContent`, `McpLifecycleLog` |
| `record.ts` | `./record` | `isPlainRecord(value)` type guard |
| `responses.ts` | `./responses` | `successResponse`, `errorResponse`, `jsonRpcId`, `messageFromError` |
| `server.ts` | `./server` | `runJsonRpcStdioServer(config)`: async-generator loop, idle timeout, opt-in parent watchdog, `McpRequestHandler`, exits on terminal output errors |
| `transport.ts` | `./transport` | `readStdioJsonRpcMessages` (async gen), `writeStdioJsonRpcResponse`, dual framing |

## CONSUMERS

- `lsp-core/src/mcp.ts` (primary): LSP MCP server.
- `ast-grep-mcp/src/mcp.ts`: ast-grep MCP server.
- `git-bash-mcp/src/mcp.ts`: Git Bash MCP server.
- `lsp-daemon/src/proxy.ts`: stdio MCP proxy; also imports `./record` from `daemon-client.ts`, `request-routing.ts`, `ipc-protocol.ts`.

## NOTES

- **Two framing modes:** `"line"` (`\n`-delimited) and `"framed"` (`Content-Length:` header per MCP spec); auto-detected by scanning the buffer prefix for `content-length:`.
- **Idle timeout uses `timer.unref()`**: the timeout never keeps the process alive.
- **Parent watchdog is opt-in and must never throw.** Omit `parentWatchdog` and no timer is created at all - deliberately so for servers that outlive their parent (the daemon server is detached). `isProcessAlive()` treats only `ESRCH` as dead and assumes alive on any other error, because a throw inside its unref'd interval would wedge the host; never swap it for a `ppid === 1` reparenting check (invalid on win32).
- **Handler contract:** return `undefined` to skip silently; `onHandlerError` catches exceptions; `parseErrorResponse` customizes JSON parse errors.
- **Output writes are awaited; closed output stops the loop:** `writeStdioJsonRpcResponse` is async and `writeChunk` removes its one-shot `error` listener after settle. `writeResponse` catches terminal output errors (`EPIPE`, `ERR_STREAM_DESTROYED`, `ERR_STREAM_WRITE_AFTER_END`), logs `output_error`, and returns false so the read loop exits; non-terminal write errors still propagate.
- **Keep zero dependencies.** `.js` suffix on relative imports (ESM). This is the floor of the package layering; it must stay leaf.
- Parent: [`packages/AGENTS.md`](../AGENTS.md).

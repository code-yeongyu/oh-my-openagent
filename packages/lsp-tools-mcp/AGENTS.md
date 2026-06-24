# lsp-tools-mcp — LSP Tools stdio MCP (MCP layer)

**Generated:** 2026-06-16

## OVERVIEW

Vendored, Node-targeted MCP-layer package (`@code-yeongyu/lsp-tools-mcp`). Serves LSP tools via stdio MCP, consuming [`lsp-core`](../lsp-core/AGENTS.md) for tool definitions + LSP runtime and [`mcp-stdio-core`](../mcp-stdio-core) for JSON-RPC framing. Registered as tier-1 MCP `lsp` in [`packages/omo-opencode/src/mcp/`](../omo-opencode/src/mcp/AGENTS.md). Used directly by the OpenCode edition and consumed by [`lsp-daemon`](../lsp-daemon/AGENTS.md) for the Codex edition.

## TOOLS SERVED

- `lsp_diagnostics`
- `lsp_goto_definition`
- `lsp_find_references`
- `lsp_symbols`
- `lsp_prepare_rename`
- `lsp_rename`
- `lsp_status`
- `lsp_install_decision`

## KEY FILES

| File | Role |
|------|------|
| `cli.ts` | Bin `omo-lsp`. `mcp` subcommand → `runMcpStdioServer()` |
| `mcp.ts` | Re-exports `@oh-my-opencode/lsp-core/mcp` (stdio MCP server + JSON-RPC handler) |
| `tools.ts` | Re-exports `@oh-my-opencode/lsp-core/tools` (tool definitions + runtime dispatch) |
| `request-context.ts` | Re-exports `@oh-my-opencode/lsp-core/request-context` |
| `lsp/manager.ts` | Re-exports `@oh-my-opencode/lsp-core/lsp/manager` |

## NOTES

- **Node + npm + vitest + biome, NOT Bun.** Built with `npm ci` + `npm run build` (triggered from root via `bun run build:lsp-tools-mcp`). `engines.node >= 20`.
- **All logic lives in `lsp-core`.** This package is a thin vendored shim that re-exports the core and adds a standalone CLI entry.
- **Config:** `.codex/lsp-client.json` (project) and `~/.codex/lsp-client.json` (user), overridable via `LSP_TOOLS_MCP_PROJECT_CONFIG` and `LSP_TOOLS_MCP_USER_CONFIG`.

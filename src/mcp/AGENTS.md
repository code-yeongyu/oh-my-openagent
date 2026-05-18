# src/mcp/ — 4 Built-in MCPs

**Generated:** 2026-05-18

## OVERVIEW

Tier 1 of the three-tier MCP system. Built-ins are created by `createBuiltinMcps(disabledMcps, config)` and now include both remote MCPs and one local stdio MCP.

## BUILT-IN MCPs

| Name | Type | Endpoint / Command | Env Vars | Tools |
|------|------|--------------------|----------|-------|
| **websearch** | remote | `mcp.exa.ai` (default) or `mcp.tavily.com` | `EXA_API_KEY` (optional), `TAVILY_API_KEY` (if tavily) | Web search |
| **context7** | remote | `mcp.context7.com/mcp` | `CONTEXT7_API_KEY` (optional) | Library documentation |
| **grep_app** | remote | `mcp.grep.app` | None | GitHub code search |
| **lsp** | local (stdio, node/bun) | `node packages/lsp-tools-mcp/dist/cli.js mcp` or `bun packages/lsp-tools-mcp/src/cli.ts mcp` | `LSP_TOOLS_MCP_PROJECT_CONFIG=.opencode/lsp.json` | `status`, diagnostics, goto definition, references, symbols, prepare_rename, rename |

## SUBMODULE ARCHITECTURE

- The local `lsp` MCP is a git submodule at `packages/lsp-tools-mcp/`.
- Upstream project: https://github.com/code-yeongyu/lsp-tools-mcp
- OMO resolves the CLI path dynamically in `src/mcp/lsp.ts` so both `src/` and `dist/` runtime layouts work.
- `lsp` is registered whenever it is not listed in `disabled_mcps`, even if the CLI artifact has not been built yet. Source checkouts fall back to the Bun source CLI; packaged builds prefer the Node dist CLI.

## THREE-TIER SYSTEM

| Tier | Source | Mechanism |
|------|--------|-----------|
| 1. Built-in | `src/mcp/` | 3 remote HTTP MCPs + 1 local stdio MCP (`lsp`) via `createBuiltinMcps()` |
| 2. Claude Code | `.mcp.json` | `${VAR}` expansion via `claude-code-mcp-loader` |
| 3. Skill-embedded | SKILL.md YAML | Managed by `SkillMcpManager` (stdio + HTTP) |

## FILES

| File | Purpose |
|------|---------|
| `index.ts` | `createBuiltinMcps()` registry for built-in MCPs |
| `types.ts` | `McpNameSchema`: `"websearch" \| "context7" \| "grep_app" \| "lsp"` |
| `websearch.ts` | Exa/Tavily provider with config |
| `context7.ts` | Context7 with optional auth header |
| `grep-app.ts` | Grep.app (no auth) |
| `lsp.ts` | Local stdio MCP config for packaged `lsp-tools-mcp` |

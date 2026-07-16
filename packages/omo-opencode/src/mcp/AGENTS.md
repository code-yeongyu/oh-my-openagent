# src/mcp/ — 5 Built-in MCPs

**Generated:** 2026-05-18

## OVERVIEW

Tier 1 of the three-tier MCP system. Built-ins are created by `createBuiltinMcps(disabledMcps, config, options)` and include remote MCPs plus the local `lsp` and `codegraph` stdio MCPs.

## BUILT-IN MCPs

| Name | Type | Endpoint / Command | Env Vars | Tools |
|------|------|--------------------|----------|-------|
| **websearch** | remote | `mcp.exa.ai` (default) or `mcp.tavily.com` | `EXA_API_KEY` (optional), `TAVILY_API_KEY` (if tavily) | Web search |
| **context7** | remote | `mcp.context7.com/mcp` | `CONTEXT7_API_KEY` (optional) | Library documentation |
| **grep_app** | remote | `mcp.grep.app` | None | GitHub code search |
| **lsp** | local (stdio, node/bun) | `node packages/lsp-tools-mcp/dist/cli.js mcp` or `bun packages/lsp-tools-mcp/src/cli.ts mcp` | `LSP_TOOLS_MCP_PROJECT_CONFIG`, `LSP_TOOLS_MCP_USER_CONFIG`, `LSP_TOOLS_MCP_INSTALL_DECISIONS` | `status`, diagnostics, goto definition, references, symbols, prepare_rename, rename |
| **codegraph** | local (stdio) | resolved `codegraph serve --mcp` (bundled npm / provisioned `~/.omo/codegraph` / PATH) | `CODEGRAPH_*` (download + telemetry off) | `codegraph_explore`, `codegraph_search`, `codegraph_node`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_files`, `codegraph_status` |

## VENDORED LSP ARCHITECTURE

- The local `lsp` MCP is vendored at `packages/lsp-tools-mcp/`.
- `packages/lsp-tools-mcp/` consumes extracted `packages/lsp-core/` + `packages/mcp-stdio-core/`; this directory only builds the OpenCode MCP config.
- Upstream project: https://github.com/code-yeongyu/lsp-tools-mcp
- OMO resolves the CLI path dynamically in `src/mcp/lsp.ts` so both `src/` and `dist/` runtime layouts work.
- `lsp` is registered whenever it is not listed in `disabled_mcps`, even if its CLI artifact has not been built yet. Source checkouts fall back to the Bun source CLI; packaged builds prefer the Node dist CLI.
- OpenCode supplies exactly three ordered project config paths to the standalone MCP translator: `<cwd>/.opencode/lsp.json`, `<cwd>/.omo/lsp.json`, and `<cwd>/.omo/lsp-client.json`.
- The user-level inputs are OpenCode config paths: `$XDG_CONFIG_HOME/opencode/lsp.json` for server config and `$XDG_CONFIG_HOME/opencode/lsp-install-decisions.json` for install decisions. The MCP context advertises `installDecisionTool: true`.
- The shared daemon runtime is configured only through `OMO_LSP_DAEMON_DIR`, or the paired `OMO_LSP_DAEMON_CLI` plus `OMO_LSP_DAEMON_VERSION` override. Source mode runs `packages/lsp-daemon/src/cli.ts` with Bun and sets the paired override; dist mode resolves the public `@code-yeongyu/lsp-daemon/cli` export rather than deep-running generated daemon files.

## THREE-TIER SYSTEM

| Tier | Source | Mechanism |
|------|--------|-----------|
| 1. Built-in | `src/mcp/` | 3 remote HTTP MCPs + 2 local stdio MCPs (`lsp`, `codegraph`) via `createBuiltinMcps()` |
| 2. Claude Code | `.mcp.json` | `${VAR}` expansion via `claude-code-mcp-loader` |
| 3. Skill-embedded | SKILL.md YAML | Managed by `SkillMcpManager` (stdio + HTTP) |

## FILES

| File | Purpose |
|------|---------|
| `index.ts` | `createBuiltinMcps()` registry for built-in MCPs |
| `types.ts` | `McpNameSchema`: `"websearch" \| "context7" \| "grep_app" \| "lsp" \| "codegraph"` |
| `websearch.ts` | Exa/Tavily provider with config |
| `context7.ts` | Context7 with optional auth header |
| `grep-app.ts` | Grep.app (no auth) |
| `lsp.ts` | Local stdio MCP config for packaged `lsp-tools-mcp` |
| `codegraph.ts` | Local stdio MCP config; resolves/gates the `codegraph` binary (gated by `config.codegraph.enabled`) |

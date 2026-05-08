# src/features/claude-code-mcp-loader/ — Tier 2 MCP Loader (.mcp.json)

**Generated:** 2026-05-08

## OVERVIEW

11 files. Loads `.mcp.json` files from project/user scopes and expands `${VAR}` env vars. Feeds Tier 2 of the 3-tier MCP system into `mcp-config-handler.ts` during Phase 5 of config loading.

## WHY IT EXISTS

Claude Code ecosystem ships MCPs via `.mcp.json` files with `${VAR}` env var placeholders. OmO consumes these unchanged so existing Claude Code MCP configs work.

## LOAD PIPELINE

```
loadMcpConfigs(ctx)
  → scope-filter.ts: discover .mcp.json at project + user scopes
  → loader.ts: parse JSON
  → env-expander.ts: replace ${VAR} with process.env[VAR]
  → transformer.ts: map Claude Code format → OpenCode McpLocal / McpRemote shape
  → return LoadedMcpServer[]
```

## MCP FORMAT

```jsonc
// .mcp.json
{
  "mcpServers": {
    "my-stdio": {
      "type": "stdio",
      "command": "node",
      "args": ["server.js"],
      "env": {
        "API_KEY": "${MY_API_KEY}"
      }
    },
    "my-http": {
      "type": "http",       // "sse" legacy → mapped to http
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${MY_TOKEN}"
      }
    }
  }
}
```

## KEY FILES

| File | Purpose |
|------|---------|
| `index.ts` | Barrel: `loadMcpConfigs`, types |
| `loader.ts` | `loadMcpConfigs()` main entry |
| `types.ts` | `ClaudeCodeMcpServer`, `LoadedMcpServer`, `McpScope` |
| `env-expander.ts` | `expandEnvVarsInObject()` — recursive `${VAR}` substitution |
| `transformer.ts` | Claude Code format → OpenCode `Mcp` shape |
| `scope-filter.ts` | Project vs user scope precedence |

## THREE-TIER MCP CONTEXT

| Tier | Loader | Scope |
|------|--------|-------|
| 1. Built-in | `src/mcp/` `createBuiltinMcps()` | Global, 3 remote HTTP MCPs |
| 2. **Claude Code** | **This module** | **From `.mcp.json`, project + user** |
| 3. Skill-embedded | `src/features/skill-mcp-manager/` | Per-session, from SKILL.md YAML |

## SECURITY

- **Env var allowlist**: `mcp_env_allowlist` config restricts which env vars can be expanded
- **No shell execution**: `${VAR}` is string replacement only, not shell `$()`
- **Secrets redaction**: `env-cleaner.ts` (in skill-mcp-manager) filters known secret patterns from logs

## RELATED

- Phase 5 integration: `src/plugin-handlers/mcp-config-handler.ts`
- Skill-embedded MCPs (Tier 3): `src/features/skill-mcp-manager/`
- Built-in MCPs (Tier 1): `src/mcp/`

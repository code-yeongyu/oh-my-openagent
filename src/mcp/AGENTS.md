# src/mcp/ — 3 Built-in Remote MCPs

**Generated:** 2026-02-17

## OVERVIEW

Tier 1 of the three-tier MCP system. 3 remote HTTP MCPs created via `createBuiltinMcps(disabledMcps, config)`.

## BUILT-IN MCPs

| Name | URL | Env Vars | Tools |
|------|-----|----------|-------|
| **websearch** | `mcp.exa.ai` (default) or `mcp.tavily.com` | `EXA_API_KEY` (optional), `TAVILY_API_KEY` (if tavily) | Web search |
| **context7** | `mcp.context7.com/mcp` | `CONTEXT7_API_KEY` (optional) | Library documentation |
| **grep_app** | `mcp.grep.app` | None | GitHub code search |

## REGISTRATION PATTERN

```typescript
// Static export (context7, grep_app)
export const context7 = {
  type: "remote" as const,
  url: "https://mcp.context7.com/mcp",
  enabled: true,
  oauth: false as const,
}

// Factory with config (websearch)
export function createWebsearchConfig(config?: WebsearchConfig): RemoteMcpConfig
```

## ENABLE/DISABLE

```jsonc
// Method 1: disabled_mcps array
{ "disabled_mcps": ["websearch", "context7"] }

// Method 2: enabled flag
{ "mcp": { "websearch": { "enabled": false } } }
```

## THREE-TIER SYSTEM

| Tier | Source | Mechanism |
|------|--------|-----------|
| 1. Built-in | `src/mcp/` | 3 remote HTTP, created by `createBuiltinMcps()` |
| 2. Claude Code | `.mcp.json` | `${VAR}` expansion via `claude-code-mcp-loader` |
| 3. Skill-embedded | SKILL.md YAML | Managed by `SkillMcpManager` (stdio + HTTP) |

## FILES

| File | Purpose |
|------|---------|
| `index.ts` | `createBuiltinMcps()` factory |
| `types.ts` | `McpNameSchema`: "websearch" \| "context7" \| "grep_app" |
| `websearch.ts` | Exa/Tavily provider with config |
| `context7.ts` | Context7 with optional auth header |
| `grep-app.ts` | Grep.app (no auth) |

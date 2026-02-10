# MCP KNOWLEDGE BASE

## OVERVIEW

Tier 1 of three-tier MCP system: 3 built-in remote HTTP MCPs.

**Three-Tier System**:
1. **Built-in** (this directory): websearch, context7, grep_app
2. **Claude Code compat** (`features/claude-code-mcp-loader/`): .mcp.json with `${VAR}` expansion
3. **Skill-embedded** (`features/opencode-skill-loader/`): YAML frontmatter in SKILL.md

## STRUCTURE
```
mcp/
├── index.ts        # createBuiltinMcps() factory
├── index.test.ts   # Tests
├── websearch.ts    # Exa AI / Tavily web search
├── context7.ts     # Library documentation
├── grep-app.ts     # GitHub code search
└── types.ts        # McpNameSchema
```

## MCP SERVERS

| Name | URL | Auth | Purpose |
|------|-----|------|---------|
| websearch | mcp.exa.ai/mcp (default) or mcp.tavily.com/mcp/ | EXA_API_KEY (optional) / TAVILY_API_KEY (required) | Real-time web search |
| context7 | mcp.context7.com/mcp | CONTEXT7_API_KEY (optional) | Library docs lookup |
| grep_app | mcp.grep.app | None | GitHub code search |

## CONFIG PATTERN

```typescript
export const mcp_name = {
  type: "remote" as const,
  url: "https://...",
  enabled: true,
  oauth: false as const,
  headers?: { ... },
}
```

## HOW TO ADD

1. Create `src/mcp/my-mcp.ts` with config object
2. Add conditional check in `createBuiltinMcps()` in `index.ts`
3. Add name to `McpNameSchema` in `types.ts`

## NOTES

- **Remote only**: HTTP/SSE transport, no stdio
- **Disable**: Set `disabled_mcps: ["name"]` in config
- **Exa**: Default provider, works without API key
- **Tavily**: Requires `TAVILY_API_KEY` env var

# MCP KNOWLEDGE BASE

## OVERVIEW

Tier 1 of three-tier MCP system: 3 built-in remote HTTP MCPs.

**Three-Tier System**:
1. **Built-in** (this directory): websearch, context7, grep_app
2. **Claude Code compat**: `.mcp.json` with `${VAR}` expansion
3. **Skill-embedded**: YAML frontmatter in skills

## STRUCTURE

```
mcp/
├── index.ts        # createBuiltinMcps() factory
├── websearch.ts    # Exa AI / Tavily web search
├── context7.ts     # Library documentation
├── grep-app.ts     # GitHub code search
├── types.ts        # McpNameSchema
└── index.test.ts   # Tests
```

## MCP SERVERS

| Name | URL | Purpose | Auth |
|------|-----|---------|------|
| websearch | mcp.exa.ai/mcp?tools=web_search_exa or mcp.tavily.com/mcp/ | Real-time web search | EXA_API_KEY (optional) / TAVILY_API_KEY (required) |
| context7 | mcp.context7.com/mcp | Library docs | CONTEXT7_API_KEY (optional) |
| grep_app | mcp.grep.app | GitHub code search | None |

## Websearch Provider Configuration

| Provider | URL | Auth | API Key Required |
|----------|-----|------|------------------|
| exa (default) | mcp.exa.ai/mcp?tools=web_search_exa | query param | No (optional) |
| tavily | mcp.tavily.com/mcp/ | Authorization Bearer | Yes |

```jsonc
{
  "websearch": {
    "provider": "tavily"  // or "exa" (default)
  }
}
```

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

1. Create `src/mcp/my-mcp.ts` with MCP config object
2. Add conditional check in `createBuiltinMcps()` in `index.ts`
3. Add name to `McpNameSchema` in `types.ts`

## NOTES

- **Remote only**: HTTP/SSE, no stdio
- **Disable**: User can set `disabled_mcps: ["name"]` in config
- **Exa**: Default provider, works without API key
- **Tavily**: Requires `TAVILY_API_KEY` env var

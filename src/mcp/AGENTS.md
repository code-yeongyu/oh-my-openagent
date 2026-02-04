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
├── websearch.ts    # Exa AI web search
├── context7.ts     # Library documentation
├── grep-app.ts     # GitHub code search
├── types.ts        # McpNameSchema
└── index.test.ts   # Tests
```

## MCP SERVERS

| Name | URL | Purpose | Auth |
|------|-----|---------|------|
| websearch | mcp.exa.ai / mcp.tavily.com | Real-time web search | EXA_API_KEY / TAVILY_API_KEY |
| context7 | mcp.context7.com/mcp | Library docs | CONTEXT7_API_KEY |
| grep_app | mcp.grep.app | GitHub code search | None |

## THREE-TIER MCP SYSTEM

1. **Built-in** (this directory): websearch, context7, grep_app
2. **Claude Code compat**: `.mcp.json` with `${VAR}` expansion
3. **Skill-embedded**: YAML frontmatter in skills (handled by skill-mcp-manager)

## Websearch Provider Configuration

The `websearch` MCP supports multiple providers. Exa is the default for backward compatibility and works without an API key.

| Provider | URL | Auth | API Key Required |
|----------|-----|------|------------------|
| exa (default) | mcp.exa.ai | x-api-key header | No (optional) |
| tavily | mcp.tavily.com | Authorization Bearer | Yes |

### Configuration Example

```jsonc
{
  "websearch": {
    "provider": "tavily"  // or "exa" (default)
  }
}
```

### Environment Variables

- `EXA_API_KEY`: Optional. Used when provider is `exa`.
- `TAVILY_API_KEY`: Required when provider is `tavily`.

### Priority and Behavior

- **Default**: Exa is used if no provider is specified.
- **Backward Compatibility**: Existing setups using `EXA_API_KEY` continue to work without changes.
- **Validation**: Selecting `tavily` without providing `TAVILY_API_KEY` will result in a configuration error.

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

## USAGE

```typescript
import { createBuiltinMcps } from "./mcp"

const mcps = createBuiltinMcps()  // Enable all
const mcps = createBuiltinMcps(["websearch"])  // Disable specific
```

## HOW TO ADD

1. Create `src/mcp/my-mcp.ts`
2. Add to `allBuiltinMcps` in `index.ts`
3. Add to `McpNameSchema` in `types.ts`

## NOTES

- **Remote only**: HTTP/SSE, no stdio
- **Disable**: User can set `disabled_mcps: ["name"]` in config
- **Context7**: Optional auth using `CONTEXT7_API_KEY` env var
- **Exa**: Optional auth using `EXA_API_KEY` env var
- **Tavily**: Requires `TAVILY_API_KEY` env var

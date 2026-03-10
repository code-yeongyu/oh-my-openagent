# MCP KNOWLEDGE BASE

## OVERVIEW

Tier 1 of three-tier MCP system: 4 built-in MCPs (3 remote HTTP + 1 local stdio).

**Three-Tier System**:
1. **Built-in** (this directory): websearch, context7, grep_app, document_reader
2. **Claude Code compat** (`features/claude-code-mcp-loader/`): .mcp.json with `${VAR}` expansion
3. **Skill-embedded** (`features/opencode-skill-loader/`): YAML frontmatter in SKILL.md

## STRUCTURE
```
mcp/
├── index.ts           # createBuiltinMcps() factory
├── index.test.ts      # Tests
├── websearch.ts       # Exa AI / Tavily web search
├── context7.ts        # Library documentation
├── grep-app.ts        # GitHub code search
├── document-reader.ts # Microsoft MarkItDown (PDF, DOCX, XLSX, PPTX, images)
└── types.ts           # McpNameSchema
```

## MCP SERVERS

| Name | Transport | Auth | Purpose |
|------|-----------|------|---------|
| websearch | remote HTTP | EXA_API_KEY (optional) / TAVILY_API_KEY (required) | Real-time web search |
| context7 | remote HTTP | CONTEXT7_API_KEY (optional) | Library docs lookup |
| grep_app | remote HTTP | None | GitHub code search |
| document_reader | local stdio (`uvx`) | None | Read PDF/DOCX/XLSX/PPTX/images → Markdown |

### document_reader Tool

**Tool name**: `document_reader__convert_to_markdown`
**Input**: `uri: string` — must be a `file:`, `https:`, `http:`, or `data:` URI
**Output**: Markdown string of document content
**Skill**: Load `document-reader` skill for usage instructions

```
file:///absolute/path/to/file.pdf     # local file (MUST be absolute)
https://example.com/report.pdf        # remote file
```

## CONFIG PATTERNS

```typescript
// Remote MCP
export const mcp_name = {
  type: "remote" as const,
  url: "https://...",
  enabled: true,
  oauth: false as const,
  headers?: { ... },
}

// Local stdio MCP
export const mcp_name = {
  type: "local" as const,
  command: ["uvx", "--from", "package-name", "command"],
  enabled: true,
}
```

## HOW TO ADD

1. Create `src/mcp/my-mcp.ts` with config object
2. Add conditional check in `createBuiltinMcps()` in `index.ts`
3. Add name to `McpNameSchema` in `types.ts`

## NOTES

- **Disable**: Set `disabled_mcps: ["name"]` in config
- **Exa**: Default websearch provider, works without API key
- **Tavily**: Requires `TAVILY_API_KEY` env var
- **document_reader**: Requires `uvx` (uv) installed on the system

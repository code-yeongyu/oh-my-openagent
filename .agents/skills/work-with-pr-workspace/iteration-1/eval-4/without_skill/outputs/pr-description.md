## Summary

- Add `arxiv` as a 4th built-in remote MCP for arXiv paper search
- Follows the `grep-app.ts` pattern: static export, no auth required (arXiv API is public)
- Fully integrated with `disabled_mcps` config and `McpNameSchema` validation

## Changes

| File | Change |
|------|--------|
| `src/mcp/arxiv.ts` | New remote MCP config pointing to arXiv MCP endpoint |
| `src/mcp/types.ts` | Add `"arxiv"` to `McpNameSchema` enum |
| `src/mcp/index.ts` | Import + register arxiv in `createBuiltinMcps()` |
| `src/mcp/index.test.ts` | Update count assertions (3 → 4), add arxiv disable test |
| `src/mcp/AGENTS.md` | Update docs to reflect 4 built-in MCPs |

## How to Test

```bash
bun test src/mcp/
```

## How to Disable

```jsonc
// Method 1: disabled_mcps
{ "disabled_mcps": ["arxiv"] }

// Method 2: enabled flag
{ "mcp": { "arxiv": { "enabled": false } } }
```

Closes #100

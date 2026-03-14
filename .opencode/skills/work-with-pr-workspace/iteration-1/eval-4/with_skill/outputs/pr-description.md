# PR: feat(mcp): add built-in arXiv paper search MCP

## Title

`feat(mcp): add built-in arXiv paper search MCP`

## Body

```markdown
## Summary

Closes #100

- Add `arxiv` as 4th built-in remote MCP for arXiv paper search
- Follows existing static export pattern (same as `grep_app`, `context7`)
- No auth required, disableable via `disabled_mcps: ["arxiv"]`

## Changes

- `src/mcp/arxiv.ts` - new MCP config (static export, remote type)
- `src/mcp/types.ts` - add `"arxiv"` to `McpNameSchema` enum
- `src/mcp/index.ts` - register arxiv in `createBuiltinMcps()`
- `src/mcp/arxiv.test.ts` - config shape tests
- `src/mcp/index.test.ts` - update counts, add disable test
- `src/mcp/AGENTS.md` - document new MCP

## Usage

Enabled by default. Disable with:

```jsonc
// .opencode/oh-my-opencode.jsonc
{
  "disabled_mcps": ["arxiv"]
}
```

## Validation

- [x] `bun run typecheck` passes
- [x] `bun test src/mcp/` passes
- [x] `bun run build` passes
```

## Labels

`enhancement`, `mcp`

## Base branch

`dev`

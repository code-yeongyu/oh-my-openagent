# Execution Plan: Add Built-in arXiv MCP (Issue #100)

## Pre-Implementation

1. **Create worktree + branch**
   ```bash
   git worktree add ../omo-arxiv-mcp dev
   cd ../omo-arxiv-mcp
   git checkout -b feat/arxiv-mcp
   ```

2. **Verify arXiv MCP endpoint exists**
   - The arXiv API is public (`export.arxiv.org/api/query`) but has no native MCP endpoint
   - Need to identify a hosted remote MCP server for arXiv (e.g., community-maintained or self-hosted)
   - If no hosted endpoint exists, consider alternatives: (a) use a community-hosted one from the MCP registry, (b) flag this in the PR and propose a follow-up for hosting
   - For this plan, assume a remote MCP endpoint at a URL like `https://mcp.arxiv.org` or a third-party equivalent

## Implementation Steps (4 files to modify, 2 files to create)

### Step 1: Create `src/mcp/arxiv.ts`
- Follow the `grep-app.ts` pattern (simplest: static export, no auth, no config)
- arXiv API is public, so no API key needed
- Export a `const arxiv` with `type: "remote"`, `url`, `enabled: true`, `oauth: false`

### Step 2: Update `src/mcp/types.ts`
- Add `"arxiv"` to the `McpNameSchema` z.enum array
- This makes it a recognized built-in MCP name

### Step 3: Update `src/mcp/index.ts`
- Import `arxiv` from `"./arxiv"`
- Add the `if (!disabledMcps.includes("arxiv"))` block inside `createBuiltinMcps()`
- Place it after `grep_app` block (alphabetical among new additions, or last)

### Step 4: Update `src/mcp/index.test.ts`
- Update test "should return all MCPs when disabled_mcps is empty" to expect 4 MCPs instead of 3
- Update test "should filter out all built-in MCPs when all disabled" to include "arxiv" in the disabled list and expect it not present
- Update test "should handle empty disabled_mcps by default" to expect 4 MCPs
- Update test "should only filter built-in MCPs, ignoring unknown names" to expect 4 MCPs
- Add new test: "should filter out arxiv when disabled"

### Step 5: Create `src/mcp/arxiv.test.ts` (optional, only if factory pattern used)
- If using static export (like grep-app), no separate test file needed
- If using factory with config, add tests following `websearch.test.ts` pattern

### Step 6: Update `src/mcp/AGENTS.md`
- Add arxiv to the built-in MCPs table
- Update "3 Built-in Remote MCPs" to "4 Built-in Remote MCPs"
- Add arxiv to the FILES table

## Post-Implementation

### Verification
```bash
bun test src/mcp/         # Run MCP tests
bun run typecheck          # Verify no type errors
bun run build             # Verify build passes
```

### PR Creation
```bash
git add src/mcp/arxiv.ts src/mcp/types.ts src/mcp/index.ts src/mcp/index.test.ts src/mcp/AGENTS.md
git commit -m "feat(mcp): add built-in arxiv paper search MCP"
git push -u origin feat/arxiv-mcp
gh pr create --title "feat(mcp): add built-in arxiv paper search MCP" --body-file /tmp/pull-request-arxiv-mcp-....md --base dev
```

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| No hosted arXiv MCP endpoint exists | Medium | Research MCP registries; worst case, create a minimal hosted wrapper or use a community server |
| Existing tests break due to MCP count change | Low | Update hardcoded count assertions from 3 to 4 |
| Config schema needs updates | None | `disabled_mcps` uses `AnyMcpNameSchema` (any string), not `McpNameSchema`, so no schema change needed for disable functionality |

## Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `src/mcp/arxiv.ts` | Create | Static remote MCP config export |
| `src/mcp/types.ts` | Modify | Add "arxiv" to McpNameSchema enum |
| `src/mcp/index.ts` | Modify | Import + register in createBuiltinMcps() |
| `src/mcp/index.test.ts` | Modify | Update count assertions, add arxiv-specific test |
| `src/mcp/AGENTS.md` | Modify | Update docs to reflect 4 MCPs |

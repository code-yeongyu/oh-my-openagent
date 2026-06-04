# Verification Strategy: Issue #100 - arXiv MCP

## Gate A: CI (`ci.yml`)

### What runs
- `bun test` (split: mock-heavy isolated + batch) - must include new `arxiv.test.ts` and updated `index.test.ts`
- `bun run typecheck` - validates `McpNameSchema` enum change propagates correctly
- `bun run build` - ensures no build regressions

### How to monitor
```bash
gh pr checks <pr-number> --watch
```

### Failure scenarios
| Failure | Likely cause | Fix |
|---------|-------------|-----|
| Type error in `types.ts` | Enum value not matching downstream consumers | Check all `McpName` usages via `lsp_find_references` |
| Test count mismatch in `index.test.ts` | Forgot to update `toHaveLength()` from 3 to 4 | Update all length assertions |
| Build failure | Import path or barrel export issue | Verify `src/mcp/index.ts` exports are clean |

### Retry
Fix locally in worktree, new commit, `git push`.

## Gate B: review-work (5-agent)

### Agents and focus areas
| Agent | What it checks for this PR |
|-------|--------------------------|
| Oracle (goal) | Does arxiv MCP satisfy issue #100 requirements? |
| Oracle (code quality) | Follows `grep-app.ts` pattern? No SRP violations? < 200 LOC? |
| Oracle (security) | No credentials hardcoded, no auth bypass |
| QA (execution) | Run tests, verify disable mechanism works |
| Context (mining) | Check issue #100 for any missed requirements |

### Pass criteria
All 5 must pass. Any single failure blocks.

### Failure handling
- Read each agent's report
- Address findings with new atomic commits
- Re-run full verify loop from Gate A

## Gate C: Cubic (`cubic-dev-ai[bot]`)

### Expected review scope
- Config shape consistency across MCPs
- Test coverage for new MCP
- Schema type safety

### Pass criteria
Comment from `cubic-dev-ai[bot]` containing "No issues found".

### Failure handling
- Read Cubic's specific findings
- Fix with new commit
- Re-push, re-enter Gate A

## Pre-merge checklist
- [ ] Gate A: CI green
- [ ] Gate B: All 5 review-work agents pass
- [ ] Gate C: Cubic "No issues found"
- [ ] No unresolved review comments
- [ ] PR has at least 1 approval (if required by branch protection)

## Post-merge
1. `gh pr merge --squash --delete-branch`
2. `git worktree remove ../omo-wt/feat/arxiv-mcp`
3. Verify merge commit on `dev` branch

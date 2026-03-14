# Verification Strategy

## Gate A: CI (`gh pr checks --watch`)

### What CI runs (from `ci.yml`)
1. **Tests (split)**: Mock-heavy tests in isolation + batch tests
2. **Typecheck**: `bun run typecheck` (tsc --noEmit)
3. **Build**: `bun run build` (ESM + declarations + schema)

### Pre-push local validation
Before pushing, run the exact CI steps locally to catch failures early:

```bash
# Targeted test runs first (fast feedback)
bun test src/features/boulder-state/storage.test.ts
bun test src/hooks/atlas/index.test.ts

# Full test suite
bun test

# Type check
bun run typecheck

# Build
bun run build
```

### Failure handling
- **Test failure**: Read test output, fix code, create new commit (never amend pushed commits), push
- **Typecheck failure**: Run `lsp_diagnostics` on changed files, fix type errors, commit, push
- **Build failure**: Check build output for missing exports or circular deps, fix, commit, push

After each fix-commit-push: `gh pr checks --watch` to re-enter gate

## Gate B: review-work (5-agent review)

### The 5 parallel agents
1. **Oracle (goal/constraint verification)**: Checks the fix matches the stated problem — `worktree_path` crash resolved, no scope creep
2. **Oracle (code quality)**: Validates code follows existing patterns — factory pattern, given/when/then tests, < 200 LOC, no catch-all files
3. **Oracle (security)**: Ensures no new security issues — JSON parse injection, path traversal in worktree_path
4. **QA agent (hands-on execution)**: Actually runs the tests, checks `lsp_diagnostics` on changed files, verifies the fix in action
5. **Context mining agent**: Checks GitHub issues, git history, related PRs for context alignment

### Expected focus areas for this PR
- Oracle (goal): Does the sanitization in `readBoulderState` actually prevent the crash? Is the `typeof` guard necessary or redundant?
- Oracle (quality): Are the new tests following the given/when/then pattern? Do they use the same mock setup as existing tests?
- Oracle (security): Is the `worktree_path` value ever used in path operations without sanitization? (Answer: no, it's only used in template strings)
- QA: Run `bun test src/hooks/atlas/index.test.ts` — does the null worktree_path test actually trigger the bug before fix?

### Failure handling
- Each oracle produces a PASS/FAIL verdict with specific issues
- On FAIL: read the specific issue, fix in the worktree, commit, push, re-run review-work
- All 5 agents must PASS

## Gate C: Cubic (`cubic-dev-ai[bot]`)

### What Cubic checks
- Automated code review bot that analyzes the PR diff
- Looks for: type safety issues, missing error handling, test coverage gaps, anti-patterns

### Expected result
- "No issues found" for this small, focused fix
- 3 files changed (storage.ts, idle-event.ts, index.test.ts) + 1 test file

### Failure handling
- If Cubic flags an issue: evaluate if it's a real concern or false positive
- Real concern: fix, commit, push
- False positive: comment explaining why the flagged pattern is intentional
- Wait for Cubic to re-review after push

## Post-verification: Merge

Once all 3 gates pass:
```bash
gh pr merge --squash --delete-branch
git worktree remove ../omo-wt/fix-atlas-worktree-path-crash
```

On merge failure (conflicts):
```bash
cd ../omo-wt/fix-atlas-worktree-path-crash
git fetch origin dev
git rebase origin/dev
# Resolve conflicts if any
git push --force-with-lease
# Re-enter verify loop from Gate A
```

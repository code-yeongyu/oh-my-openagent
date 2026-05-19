# Verification Strategy

## Gate A: CI (`ci.yml`)

### Pre-push local validation
```bash
bun run typecheck                              # Zero new type errors
bun test src/hooks/comment-checker/            # All comment-checker tests pass
bun test src/config/                           # Config schema tests pass
bun run build                                  # Build succeeds
```

### CI pipeline expectations
| Step | Expected |
|------|----------|
| Tests (mock-heavy isolated) | Pass - comment-checker tests run in isolation |
| Tests (batch) | Pass - no regression in other hook tests |
| Typecheck (`tsc --noEmit`) | Pass - new `exclude_patterns` field is `z.array(z.string()).optional()` |
| Build | Pass - schema change is additive |
| Schema auto-commit | May trigger if schema JSON is auto-generated |

### Failure handling
- Type errors: Fix in worktree, new commit, push
- Test failures: Investigate, fix, new commit, push
- Schema auto-commit conflicts: Rebase on dev, resolve, force push

## Gate B: review-work (5-agent)

### Agent expectations

| Agent | Role | Focus Areas |
|-------|------|-------------|
| Oracle (goal) | Verify fix addresses false positive issue | Config schema matches PR description, exclude_patterns flows correctly |
| Oracle (code quality) | Code quality check | Factory pattern consistency, no catch-all files, <200 LOC |
| Oracle (security) | Security review | Regex patterns are user-supplied - verify no ReDoS risk from config |
| Hephaestus (QA) | Hands-on execution | Run tests, verify mock binary tests actually exercise the exclude flow |
| Hephaestus (context) | Context mining | Check git history for related changes, verify no conflicting PRs |

### Potential review-work flags
1. **ReDoS concern**: User-supplied regex patterns in `exclude_patterns` could theoretically cause ReDoS in the Go binary. Mitigation: the patterns are passed as CLI args, Go's `regexp` package is RE2-based (linear time guarantee).
2. **Breaking change check**: Adding optional field to config schema is non-breaking (Zod `z.optional()` fills default).
3. **Go binary dependency**: The `--exclude-pattern` flag must exist in the Go binary for this to work. If the binary doesn't support it yet, the patterns are silently ignored (binary treats unknown flags differently).

### Failure handling
- If any Oracle flags issues: address feedback, push new commit, re-run review-work
- If Hephaestus QA finds test gaps: add missing tests, push, re-verify

## Gate C: Cubic (`cubic-dev-ai[bot]`)

### Expected review focus
- Schema change additive and backward-compatible
- Parameter threading is mechanical and low-risk
- Tests use mock binaries (shell scripts) - standard project pattern per `cli.test.ts`

### Success criteria
- `cubic-dev-ai[bot]` comments "No issues found"
- No requested changes

### Failure handling
- If Cubic flags issues: read comment, address, push fix, re-request review via:
  ```bash
  gh pr review --request-changes --body "Addressed Cubic feedback"
  ```
  Then push fix and wait for re-review.

## Post-merge verification

1. Confirm squash merge landed on `dev`
2. Verify CI passes on `dev` branch post-merge
3. Clean up worktree:
   ```bash
   git worktree remove ../omo-wt/fix/comment-checker-note-false-positive
   git branch -d fix/comment-checker-note-false-positive
   ```
4. File issue on `code-yeongyu/go-claude-code-comment-checker` to add `--exclude-pattern` flag support and relax the `note:` regex upstream

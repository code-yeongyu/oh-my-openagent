# Verification Strategy

## Pre-Push Local Validation

Before every push, run all three checks sequentially:

```bash
bun run typecheck && bun test && bun run build
```

Specific test files to watch:
```bash
bun test src/config/schema/background-task.test.ts
bun test src/features/background-agent/concurrency.test.ts
```

---

## Gate A: CI (`ci.yml`)

### What CI runs
1. **Tests (split):** mock-heavy tests run in isolation (separate `bun test` processes), rest in batch
2. **Typecheck:** `bun run typecheck` (tsc --noEmit)
3. **Build:** `bun run build` (ESM + declarations + schema)
4. **Schema auto-commit:** if generated schema changed, CI commits it

### How to monitor
```bash
gh pr checks <PR_NUMBER> --watch
```

### Common failure scenarios and fixes

| Failure | Likely Cause | Fix |
|---------|-------------|-----|
| Typecheck error | New field not matching existing type imports | Verify `BackgroundTaskConfig` type is auto-inferred from schema, no manual type updates needed |
| Test failure | Test assertion wrong or missing import | Fix test, re-push |
| Build failure | Import cycle or missing export | Check barrel exports in `src/config/schema.ts` (already re-exports via `export *`) |
| Schema auto-commit | Generated JSON schema changed | Pull the auto-commit, rebase if needed |

### Recovery
```bash
# Read CI logs
gh run view <RUN_ID> --log-failed

# Fix, commit, push
git add -A && git commit -m "fix: address CI failure" && git push
```

---

## Gate B: review-work (5 parallel agents)

### What it checks
Run `/review-work` which launches 5 background sub-agents:

| Agent | Role | What it checks for this PR |
|-------|------|---------------------------|
| Oracle (goal) | Goal/constraint verification | Does `maxBackgroundAgents` actually limit agents? Is default 5? Is min 1? |
| Oracle (quality) | Code quality | Follows existing patterns? No catch-all files? Under 200 LOC? given/when/then tests? |
| Oracle (security) | Security review | No injection vectors, no unsafe defaults, proper input validation via Zod |
| Hephaestus (QA) | Hands-on QA execution | Actually runs tests, checks typecheck, verifies build |
| Hephaestus (context) | Context mining | Checks git history, related issues, ensures no duplicate/conflicting PRs |

### Pass criteria
All 5 agents must pass. Any single failure blocks.

### Common failure scenarios and fixes

| Agent | Likely Issue | Fix |
|-------|-------------|-----|
| Oracle (goal) | Global limit not enforced in all exit paths (completion, cancel, error, interrupt) | Audit every status transition in `manager.ts` that should call `releaseGlobal()` |
| Oracle (quality) | Test style not matching given/when/then | Restructure tests with `#given`/`#when`/`#then` describe nesting |
| Oracle (quality) | File exceeds 200 LOC | `concurrency.ts` is 137 LOC + ~25 new = ~162 LOC, safe. `manager.ts` is already large but we're adding ~20 lines to existing methods, not creating new responsibility |
| Oracle (security) | Integer overflow or negative values | Zod `.int().min(1)` handles this at config parse time |
| Hephaestus (QA) | Test actually fails when run | Run tests locally first, fix before push |

### Recovery
```bash
# Review agent output
background_output(task_id="<review-work-task-id>")

# Fix identified issues
# ... edit files ...
git add -A && git commit -m "fix: address review-work feedback" && git push
```

---

## Gate C: Cubic (`cubic-dev-ai[bot]`)

### What it checks
Cubic is an automated code review bot that analyzes the PR diff. It must respond with "No issues found" for the gate to pass.

### Common failure scenarios and fixes

| Issue | Likely Cause | Fix |
|-------|-------------|-----|
| "Missing error handling" | `releaseGlobal()` not called in some error path | Add `releaseGlobal()` to the missed path |
| "Inconsistent naming" | Field name doesn't match convention | Use `maxBackgroundAgents` (camelCase in schema, `max_background_agents` in JSONC config) |
| "Missing documentation" | No JSDoc on new public methods | Add JSDoc comments to `canSpawnGlobally()`, `acquireGlobal()`, `releaseGlobal()`, `getMaxBackgroundAgents()` |
| "Test coverage gap" | Missing edge case test | Add the specific test case Cubic identifies |

### Recovery
```bash
# Read Cubic's review
gh api repos/code-yeongyu/oh-my-openagent/pulls/<PR_NUMBER>/reviews

# Address each comment
# ... edit files ...
git add -A && git commit -m "fix: address Cubic review feedback" && git push
```

---

## Verification Loop Pseudocode

```
iteration = 0
while true:
  iteration++
  log("Verification iteration ${iteration}")

  # Gate A: CI (cheapest, check first)
  push_and_wait_for_ci()
  if ci_failed:
    read_ci_logs()
    fix_and_commit()
    continue

  # Gate B: review-work (5 agents, more expensive)
  run_review_work()
  if any_agent_failed:
    read_agent_feedback()
    fix_and_commit()
    continue

  # Gate C: Cubic (external bot, wait for it)
  wait_for_cubic_review()
  if cubic_has_issues:
    read_cubic_comments()
    fix_and_commit()
    continue

  # All gates passed
  break

# Merge
gh pr merge <PR_NUMBER> --squash --delete-branch
```

No iteration cap. Loop continues until all three gates pass simultaneously in a single iteration.

---

## Risk Assessment

| Risk | Probability | Mitigation |
|------|------------|------------|
| Slot leak (global count never decremented) | Medium | Audit every exit path: `tryCompleteTask`, `cancelTask`, `handleEvent(session.error)`, `startTask` prompt error, `resume` prompt error |
| Race condition on global count | Low | `globalRunningCount` is synchronous (single-threaded JS), no async gap between check and increment in `launch()` |
| Breaking existing behavior | Low | Default is 5, same as existing per-model default. Users with <5 total agents see no change |
| `manager.ts` exceeding 200 LOC | Already exceeded | File is already ~1500 LOC (exempt due to being a core orchestration class with many methods). Our changes add ~20 lines to existing methods, not a new responsibility |

# Execution Plan: `max_background_agents` Config Option

## Phase 0: Setup — Branch + Worktree

1. **Create branch** from `dev`:
   ```bash
   git checkout dev && git pull origin dev
   git checkout -b feat/max-background-agents
   ```

2. **Create worktree** in sibling directory:
   ```bash
   mkdir -p ../omo-wt
   git worktree add ../omo-wt/feat-max-background-agents feat/max-background-agents
   ```

3. **All subsequent work** happens in `../omo-wt/feat-max-background-agents/`, never in the main worktree.

---

## Phase 1: Implement — Atomic Commits

### Commit 1: Add `max_background_agents` to config schema

**Files changed:**
- `src/config/schema/background-task.ts` — Add `maxBackgroundAgents` field to `BackgroundTaskConfigSchema`
- `src/config/schema/background-task.test.ts` — Add validation tests for the new field

**What:**
- Add `maxBackgroundAgents: z.number().int().min(1).optional()` to `BackgroundTaskConfigSchema`
- Default value handled at runtime (5), not in schema (all schema fields are optional per convention)
- Add given/when/then tests: valid value, below minimum, not provided, non-number

### Commit 2: Enforce limit in BackgroundManager + ConcurrencyManager

**Files changed:**
- `src/features/background-agent/concurrency.ts` — Add global agent count tracking + `getGlobalRunningCount()` + `canSpawnGlobally()`
- `src/features/background-agent/concurrency.test.ts` — Tests for global limit enforcement
- `src/features/background-agent/manager.ts` — Check global limit before `launch()` and `trackTask()`

**What:**
- `ConcurrencyManager` already manages per-model concurrency. Add a separate global counter:
  - `private globalRunningCount: number = 0`
  - `private maxBackgroundAgents: number` (from config, default 5)
  - `acquireGlobal()` / `releaseGlobal()` methods
  - `getGlobalRunningCount()` for observability
- `BackgroundManager.launch()` checks `concurrencyManager.canSpawnGlobally()` before creating task
- `BackgroundManager.trackTask()` also checks global limit
- On task completion/cancellation/error, call `releaseGlobal()`
- Throw descriptive error when limit hit: `"Background agent spawn blocked: ${current} agents running, max is ${max}. Wait for existing tasks to complete or increase background_task.maxBackgroundAgents."`

### Local Validation

```bash
bun run typecheck
bun test src/config/schema/background-task.test.ts
bun test src/features/background-agent/concurrency.test.ts
bun run build
```

---

## Phase 2: PR Creation

1. **Push branch:**
   ```bash
   git push -u origin feat/max-background-agents
   ```

2. **Create PR** targeting `dev`:
   ```bash
   gh pr create \
     --base dev \
     --title "feat: add max_background_agents config to limit concurrent background agents" \
     --body-file /tmp/pull-request-max-background-agents-$(date +%s).md
   ```

---

## Phase 3: Verify Loop

### Gate A: CI
- Wait for `ci.yml` workflow to complete
- Check: `gh pr checks <PR_NUMBER> --watch`
- If fails: read logs, fix, push, re-check

### Gate B: review-work (5 agents)
- Run `/review-work` skill which launches 5 parallel background sub-agents:
  1. Oracle — goal/constraint verification
  2. Oracle — code quality
  3. Oracle — security
  4. Hephaestus — hands-on QA execution
  5. Hephaestus — context mining from GitHub/git
- All 5 must pass. If any fails, fix and re-push.

### Gate C: Cubic (cubic-dev-ai[bot])
- Wait for Cubic bot review on PR
- Must say "No issues found"
- If issues found: address feedback, push, re-check

### Loop
```
while (!allGatesPass) {
  if (CI fails) → fix → push → continue
  if (review-work fails) → fix → push → continue
  if (Cubic has issues) → fix → push → continue
}
```

---

## Phase 4: Merge + Cleanup

1. **Squash merge:**
   ```bash
   gh pr merge <PR_NUMBER> --squash --delete-branch
   ```

2. **Remove worktree:**
   ```bash
   git worktree remove ../omo-wt/feat-max-background-agents
   ```

---

## File Impact Summary

| File | Change Type |
|------|-------------|
| `src/config/schema/background-task.ts` | Modified — add schema field |
| `src/config/schema/background-task.test.ts` | Modified — add validation tests |
| `src/features/background-agent/concurrency.ts` | Modified — add global limit tracking |
| `src/features/background-agent/concurrency.test.ts` | Modified — add global limit tests |
| `src/features/background-agent/manager.ts` | Modified — enforce global limit in launch/trackTask |

5 files changed across 2 atomic commits. No new files created (follows existing patterns).

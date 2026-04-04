# Execution Plan — Fix atlas hook crash on missing worktree_path

## Phase 0: Setup

1. **Create worktree from origin/dev**:
   ```bash
   git fetch origin dev
   git worktree add ../omo-wt/fix-atlas-worktree-path-crash origin/dev
   ```
2. **Create feature branch**:
   ```bash
   cd ../omo-wt/fix-atlas-worktree-path-crash
   git checkout -b fix/atlas-worktree-path-crash
   ```

## Phase 1: Implement

### Step 1: Fix `readBoulderState()` in `src/features/boulder-state/storage.ts`
- Add `worktree_path` sanitization after JSON parse
- Ensure `worktree_path` is `string | undefined`, never `null` or other types
- This is the root cause: raw `JSON.parse` + `as BoulderState` cast allows type violations at runtime

### Step 2: Add defensive guard in `src/hooks/atlas/idle-event.ts`
- Before passing `boulderState.worktree_path` to `injectContinuation`, validate it's a string
- Apply same guard in the `scheduleRetry` callback (line 86)
- Ensures even if `readBoulderState` is bypassed, the idle handler won't crash

### Step 3: Add test coverage in `src/hooks/atlas/index.test.ts`
- Add test: boulder.json without `worktree_path` field → session.idle works
- Add test: boulder.json with `worktree_path: null` → session.idle works (no `[Worktree: null]` in prompt)
- Add test: `readBoulderState` sanitizes `null` worktree_path to `undefined`
- Follow existing given/when/then test pattern

### Step 4: Local validation
```bash
bun run typecheck
bun test src/hooks/atlas/
bun test src/features/boulder-state/
bun run build
```

### Step 5: Atomic commit
```bash
git add src/features/boulder-state/storage.ts src/hooks/atlas/idle-event.ts src/hooks/atlas/index.test.ts
git commit -m "fix(atlas): prevent crash when boulder.json missing worktree_path field

readBoulderState() performs unsafe cast of parsed JSON as BoulderState.
When worktree_path is absent or null in boulder.json, downstream code
in idle-event.ts could receive null where string|undefined is expected.

- Sanitize worktree_path in readBoulderState (reject non-string values)
- Add defensive typeof check in idle-event before passing to continuation
- Add test coverage for missing and null worktree_path scenarios"
```

## Phase 2: PR Creation

```bash
git push -u origin fix/atlas-worktree-path-crash
gh pr create \
  --base dev \
  --title "fix(atlas): prevent crash when boulder.json missing worktree_path" \
  --body-file /tmp/pull-request-atlas-worktree-fix.md
```

## Phase 3: Verify Loop

- **Gate A (CI)**: `gh pr checks --watch` — wait for all checks green
- **Gate B (review-work)**: Run 5-agent review (Oracle goal, Oracle quality, Oracle security, QA execution, context mining)
- **Gate C (Cubic)**: Wait for cubic-dev-ai[bot] to respond "No issues found"
- On any failure: fix-commit-push, re-enter verify loop

## Phase 4: Merge

```bash
gh pr merge --squash --delete-branch
git worktree remove ../omo-wt/fix-atlas-worktree-path-crash
```

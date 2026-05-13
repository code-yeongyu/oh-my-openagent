# Verification Strategy

## 1. Unit Tests (Direct Verification)

### boulder-state storage tests
```bash
bun test src/features/boulder-state/storage.test.ts
```

Verify:
- `readBoulderState()` returns `null` when `active_plan` missing
- `readBoulderState()` returns `null` when `plan_name` missing
- `readBoulderState()` strips non-string `worktree_path` (e.g., `null`)
- `readBoulderState()` preserves valid string `worktree_path`
- `getPlanProgress(undefined)` returns safe default without crashing
- Existing tests still pass (session_ids defaults, empty object, etc.)

### atlas hook tests
```bash
bun test src/hooks/atlas/index.test.ts
```

Verify:
- session.idle handler works with boulder state missing `worktree_path` (no crash, prompt injected)
- session.idle handler includes `[Worktree: ...]` context when `worktree_path` IS present
- All 30+ existing tests still pass

### atlas idle-event lineage tests
```bash
bun test src/hooks/atlas/idle-event-lineage.test.ts
```

Verify existing lineage tests unaffected.

### start-work hook tests
```bash
bun test src/hooks/start-work/index.test.ts
```

Verify worktree-related start-work tests still pass (these create boulder states with/without `worktree_path`).

## 2. Type Safety

```bash
bun run typecheck
```

Verify zero new TypeScript errors. The changes are purely additive runtime guards that align with existing types (`worktree_path?: string`).

## 3. LSP Diagnostics on Changed Files

```
lsp_diagnostics on:
  - src/features/boulder-state/storage.ts
  - src/hooks/atlas/idle-event.ts
```

Verify zero errors/warnings.

## 4. Full Test Suite

```bash
bun test
```

Verify no regressions across the entire codebase.

## 5. Build

```bash
bun run build
```

Verify build succeeds.

## 6. Manual Smoke Test (Reproduction)

To manually verify the fix:

```bash
# Create a malformed boulder.json (missing worktree_path)
mkdir -p .sisyphus
echo '{"active_plan": ".sisyphus/plans/test.md", "plan_name": "test", "session_ids": ["ses-1"]}' > .sisyphus/boulder.json

# Create a plan file
mkdir -p .sisyphus/plans
echo '# Plan\n- [ ] Task 1' > .sisyphus/plans/test.md

# Start opencode - atlas hook should NOT crash when session.idle fires
# Verify /tmp/oh-my-opencode.log shows normal continuation behavior
```

Also test the extreme case:
```bash
# boulder.json with no required fields
echo '{}' > .sisyphus/boulder.json

# After fix: readBoulderState returns null, atlas hook gracefully skips
```

## 7. CI Pipeline

After pushing the branch, verify:
- `ci.yml` workflow passes: tests (split: mock-heavy isolated + batch), typecheck, build
- No new lint warnings

## 8. Edge Cases Covered

| Scenario | Expected Behavior |
|----------|-------------------|
| `boulder.json` = `{}` | `readBoulderState` returns `null` |
| `boulder.json` missing `active_plan` | `readBoulderState` returns `null` |
| `boulder.json` missing `plan_name` | `readBoulderState` returns `null` |
| `boulder.json` has `worktree_path: null` | Field stripped, returned as `undefined` |
| `boulder.json` has `worktree_path: 42` | Field stripped, returned as `undefined` |
| `boulder.json` has no `worktree_path` | Works normally, no crash |
| `boulder.json` has valid `worktree_path` | Preserved, included in continuation prompt |
| setTimeout retry with corrupted boulder.json | Error caught and logged, no process crash |
| `getPlanProgress(undefined)` | Returns `{ total: 0, completed: 0, isComplete: true }` |

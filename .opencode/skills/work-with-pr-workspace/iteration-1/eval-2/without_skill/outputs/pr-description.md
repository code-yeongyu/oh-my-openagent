## Summary

- Fix crash in atlas hook when `boulder.json` is missing `worktree_path` (or other required fields) by hardening `readBoulderState()` validation
- Wrap the unprotected `setTimeout` retry callback in `idle-event.ts` with try/catch to prevent unhandled promise rejections
- Add defensive type guard in `getPlanProgress()` to prevent `existsSync(undefined)` TypeError

## Context

When `boulder.json` is malformed or manually edited to omit fields, `readBoulderState()` returns an object cast as `BoulderState` without validating required fields. Downstream callers like `getPlanProgress(boulderState.active_plan)` then pass `undefined` to `existsSync()`, which throws a TypeError. This crash is especially dangerous in the `setTimeout` retry callback in `idle-event.ts`, where the error becomes an unhandled promise rejection.

## Changes

### `src/features/boulder-state/storage.ts`
- `readBoulderState()`: Validate `active_plan` and `plan_name` are strings (return `null` if not)
- `readBoulderState()`: Strip `worktree_path` if present but not a string type
- `getPlanProgress()`: Add `typeof planPath !== "string"` guard before `existsSync`

### `src/hooks/atlas/idle-event.ts`
- Wrap `scheduleRetry` setTimeout async callback body in try/catch

### Tests
- `src/features/boulder-state/storage.test.ts`: 5 new tests for missing/malformed fields
- `src/hooks/atlas/index.test.ts`: 2 new tests for worktree_path presence/absence in continuation prompt

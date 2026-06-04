# PR Title

```
fix(atlas): prevent crash when boulder.json missing worktree_path
```

# PR Body

## Summary

- Fix runtime type violation in atlas hook when `boulder.json` lacks `worktree_path` field
- Add `worktree_path` sanitization in `readBoulderState()` to reject non-string values (e.g., `null` from manual edits)
- Add defensive `typeof` guards in `idle-event.ts` before passing worktree path to continuation injection
- Add test coverage for missing and null `worktree_path` scenarios

## Problem

`readBoulderState()` in `src/features/boulder-state/storage.ts` casts raw `JSON.parse()` output directly as `BoulderState` via `return parsed as BoulderState`. This bypasses TypeScript's type system entirely at runtime.

When `boulder.json` is missing the `worktree_path` field (common for boulders created before worktree support was added, or created without `--worktree` flag), `boulderState.worktree_path` is `undefined` which is handled correctly. However, when boulder.json has `"worktree_path": null` (possible from manual edits, external tooling, or corrupted state), the runtime type becomes `null` which violates the TypeScript type `string | undefined`.

This `null` value propagates through:
1. `idle-event.ts:handleAtlasSessionIdle()` → `injectContinuation()` → `injectBoulderContinuation()`
2. `idle-event.ts:scheduleRetry()` callback → same chain

While the `boulder-continuation-injector.ts` handles falsy values via `worktreePath ? ... : ""`, the type mismatch can cause subtle downstream issues and violates the contract of the `BoulderState` interface.

## Changes

| File | Change |
|------|--------|
| `src/features/boulder-state/storage.ts` | Sanitize `worktree_path` in `readBoulderState()` — reject non-string values |
| `src/hooks/atlas/idle-event.ts` | Add `typeof` guards before passing worktree_path to continuation (2 call sites) |
| `src/hooks/atlas/index.test.ts` | Add 2 tests: missing worktree_path + null worktree_path in session.idle |
| `src/features/boulder-state/storage.test.ts` | Add 2 tests: sanitization of null + preservation of valid string |

## Testing

- `bun test src/hooks/atlas/` — all existing + new tests pass
- `bun test src/features/boulder-state/` — all existing + new tests pass
- `bun run typecheck` — clean
- `bun run build` — clean

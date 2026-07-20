# Atlas final-wave approval pause — multi-work scoping fix

Reviewer: @acamq (PR #6224, comment 2026-07-20T16:22:32Z)
Branch: `fix/atlas-reviewer-loop`
Date: 2026-07-20

## WHAT WAS TESTED

The reviewer's blocking comment identified that `setBoulderPause()` and
`clearBoulderPause()` mutated `state.works[state.active_work_id]` regardless
of which work owned `input.sessionId`. When Atlas processes a session for a
non-active Boulder work B, the pause was wrongly written onto active work A
and the top-level mirror, then dropped when B was later selected via
`projectWorkToMirror()`.

The fix routes set/clear through `getWorkForSession()` to find the owning
work, mutates `work.pause` on that work only, and updates the top-level
mirror only when the owning work is the active work. `clearBoulderPause()`
was made symmetric with `isBoulderPausedForSession()`'s lookup path.

## WHAT WAS OBSERVED

### Targeted boulder-state storage regression
Command: `bun test packages/boulder-state/src/write-state-pause.test.ts`
File: `focused-tests.txt`

```
5 pass, 0 fail, 18 expect() calls
```

Covers:
- pause set on B (A active) → B paused, A + top-level mirror untouched
- selectActiveWork(B) → pause survives `projectWorkToMirror`
- clearBoulderPause via B session → only B cleared, A untouched
- pause set + clear on active work A → both top-level mirror and A's pause update
- legacy single-work state (no `works` map) → pause lives on top-level mirror

### Full boulder-state suite
Command: `bun test packages/boulder-state`

```
36 pass, 0 fail, 55 expect() calls  (4 files)
```

### Atlas hook regression suite (touches the storage layer via the hook)
Command: `bun test packages/omo-opencode/src/hooks/atlas`

```
210 pass, 0 fail, 475 expect() calls  (26 files)
```

Includes the prior `final-wave-approval-gate-regression.test.ts` regressions
(the non-pausing subagent completion invariant from commit d9144eb2b still
passes) and `todo-continuation-enforcer` parent-wake race / continuation
injection regressions.

### Typechecks
- `bunx tsgo --noEmit -p packages/boulder-state/tsconfig.json` → 0 errors
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json` → 0 errors

### Build
- `bun run build` → completes successfully

## WHY IT IS ENOUGH

- The new storage-level regression pins exactly the four-step scenario the
  reviewer requested: set on B with A active (assert B paused, A + mirror
  untouched), select B (assert pause survives mirror projection), clear via
  B session (assert only B cleared).
- Existing atlas final-wave-approval regressions continue to pass — the
  single-work / active-work path (where the mirror IS updated) is preserved.
- The fix is symmetric with `isBoulderPausedForSession()`, which already
  resolved the owning work via `getWorkForSession()` and fell back to the
  mirror. The pause read path, set path, and clear path now agree.
- Build and per-package typechecks are clean for both touched packages.

## WHAT WAS OMITTED

- Live Docker OpenCode SSE hook probe: not re-run for this delta because the
  change is at the storage layer (pure-TS Boulder state), covered by storage
  unit tests and the existing atlas hook integration tests. The previous
  evidence at `.omo/evidence/20260719-atlas-final-wave-pause/` covers the
  broader hook-firing surface.
- Broad `bun run typecheck:packages`: still blocked pre-existing by
  `packages/pi-goal` missing `@mariozechner/pi-coding-agent`, unrelated to
  this change. Direct typechecks for the two touched packages pass.

## Files changed

- `packages/boulder-state/src/storage/write-state.ts` — `setBoulderPause` and
  `clearBoulderPause` now resolve the owning work via `getWorkForSession()`.
- `packages/boulder-state/src/write-state-pause.test.ts` — new multi-work
  regression (5 tests).

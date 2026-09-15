# QA Evidence: Fix #5120 Sisyphus infinite planning loop

Date: 2026-08-25 | Branch: issue/5120-sisyphus-planning-loop | Base: c7094b8ac

## WHAT WAS TESTED

- Surface: `packages/omo-opencode/src/hooks/todo-continuation-enforcer/session-state.ts`
  `trackContinuationProgress()` - the progress oracle that decides whether a
  post-injection turn counts as progress for the Boulder continuation engine
  (the mechanism that re-injects CONTINUATION_PROMPT on session.idle).
- Behavior under test: todo status churn without completion-count movement
  (the "Goal / Progress (Done/In Progress/Blocked) / Key Decisions" planning
  echo reported in issue #5120) must NOT reset the stagnation counter, so the
  existing terminators (`MAX_STAGNATION_COUNT = 3` via `shouldStopForStagnation`,
  and the `directive-response` continuation block) can stop the loop.
- Commands:
  - `bun test packages/omo-opencode/src/hooks/todo-continuation-enforcer/session-state.test.ts`
    run BEFORE the fix with the fix stashed (`git stash push -- <file>`) to prove failing-first.
  - Same command after the fix; then the full scoped gate
    `bun test packages/omo-opencode/src/hooks/todo-continuation-enforcer/`.
  - `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`.
  - `OMO_SKIP_MATERIALIZE=1 bun run build` (offline env; skip flag is the script's own).

## WHAT WAS OBSERVED

- Failing-first (fix stashed): exactly the two new #5120 tests fail -
  churn reads as `hasProgressed: true`, stagnation never accumulates,
  `shouldStopForStagnation` stays false => unbounded re-injection reproduced
  at unit level. All 10 pre-existing tests pass. Artifact: `failing-first.red.log`.
- After fix: 12/12 pass in session-state.test.ts; full hook dir 146 pass /
  0 fail across 17 files. Artifacts: `hook-dir.green.log`.
- Typecheck: exit 0. Artifact: `typecheck.log`.
- Build: all steps completed with OMO_SKIP_MATERIALIZE=1 (network-restricted env;
  materialize clones shared-skills upstreams which cannot be fetched here).
- Isolation: unit-level store tests only; no opencode process spawned, no
  XDG/state dirs touched. Worktree left clean except the two intended source
  files (build-dirtied tracked bundles and submodule state were restored).

## WHY IT IS ENOUGH

The infinite loop is fully determined by the store's progress predicate: the
enforcer injects only after cooldown, stagnation accumulates only on turns
following an injection, and both terminators consume exactly the
`ContinuationProgressUpdate` this change fixes. The red/green pair proves the
loop shape (churn = progress forever) becomes bounded (churn = stagnation,
stop at 3). Real completion progress (completed-count increase or
incomplete-count decrease) still resets stagnation and clears
`continuationBlockReason`, pinned by pre-existing tests that pass unchanged
("incomplete count decreases", "one completes while another is added",
"progress clears interruption block"). Residual risk: a legitimate reply that
only reorganizes todos without completing anything now counts toward the
3-strike stop; recovery remains possible via any later monotonic progress.

## WHAT WAS OMITTED

- Live OpenCode harness drive (opencode-qa skill lanes): requires a model
  provider round-trip to reproduce an idle planning loop end-to-end; this
  environment is network-restricted (bun install needed --offline; upstream
  materialize clones fail), so no live repro was attempted. The changed seam
  is the exact decision function those live runs would exercise.
- Root-wide `bun test` and full `bun run typecheck`: scoped per task directive
  to the touched package/hook; the removed symbols were module-private
  (verified by repo grep) so no external consumer exists.

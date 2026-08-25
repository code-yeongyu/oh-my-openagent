# Plan: DAG scheduler dependency-frontier admission (dag_530ad299 stall, part 2)

## Problem

`runWaves` (scheduler.ts) iterates the precomputed wave list with a full-settle barrier:
`admitAndSettleWave` awaits EVERY node of wave N before wave N+1 is scanned. The Dag tool's
documented contract is dependency semantics ("a node starts only after every node it dependsOn
has finished"). Incident dag_530ad299: lane-b (dependsOn lane-a, completed) starved for hours
behind unrelated wave-0 sibling lane-c. The sibling PR (#7320, merged) fixed the recovery-side
block; this PR removes the barrier itself.

## Change set

1. `packages/senpi-task/src/dag/scheduler.ts`
   - Replace `runWaves` + `admitAndSettleWave` with a dependency-frontier loop:
     - `runFrontier`: per iteration: cancellation check -> `applyDependentSkipCascade` ->
       `emitCompletedWaves` -> `admitFrontier` -> all-terminal check -> `settleOne`.
     - `admitFrontier`: one admission pass = retry the ordered residency-denied queue first,
       then newly runnable nodes (state pending|blocked AND every dependsOn node `completed`),
       grouped `dag.wave.started` per wave index (ascending), then `startOwned` batch with the
       preserved residency_denied retry loop (settle one to free a slot, retry; fail with
       `residency_denied` when nothing is attached).
   - `dag.wave.started` = informational grouping of newly scheduled nodes (a wave index may
     appear more than once when its nodes become ready at different times).
   - `dag.wave.completed` = informational, once per instance per wave index, when EVERY member
     of the wave is terminal; nodeIds = full wave membership; only for waves that received a
     started this instance. Never emitted on the cancellation exit path.
   - PRESERVED: preAttachedTasks folding (sibling PR), watchRevivedInScheduler, skip cascade,
     cancellation semantics (admissionIdle gate), retry/send/reentry, spawn policy, startSpec,
     owner fingerprints, foldTaskOutcome, primaryFailure ordering.
   - Header comment rewrite (line 1).
2. `packages/senpi-task/src/dag/manager.ts` + `fingerprint.ts`: `waveAdmission:
   "strict-barrier"` -> `"dependency-frontier"`. The fingerprint input MUST change when
   admission semantics change (manager.ts comment is explicit). fingerprint.test.ts pins updated.
3. `packages/senpi-task/src/dag/scheduler.test.ts`
   - Replace the pinned barrier test (was line ~840) with the new contract pair: dependent
     admitted while an unrelated sibling runs; dependent NOT admitted before its dependency
     is terminal.
   - Adapt "running wave and pending descendants" cancellation test: `next` is now admitted
     (frontier) before the cancel lands; starts/cancellations/cancelledNodeIds updated.
   - describe rename off "strict wave barrier".
4. `packages/senpi-task/src/dag/e2e-happy.test.ts`: mixed-eight event sequence adapted to the
   staggered informational groupings (linear + diamond sequences unchanged and still pinned).
5. NEW `packages/senpi-task/src/dag/scheduler-frontier.test.ts`: adapted R2 regression
   (event-driven, no sleeps) + residency/frontier interplay coverage.
6. Docs: `src/dag/AGENTS.md` (conventions + scheduler row), `packages/senpi-task/AGENTS.md`
   (DAG rows), root `AGENTS.md` WHERE TO LOOK row if needed.

## Verification

- RED: new regression file on pristine origin/dev worktree -> captured output.
- GREEN: `bun test packages/senpi-task` in this worktree, exit 0, run twice for stability.
- `tsgo --noEmit -p packages/senpi-task/tsconfig.json`.
- `bun run build` bundle-drift check (restore unintended drift).
- Evidence in this dir; PR to dev, watch CI, merge with merge commit.

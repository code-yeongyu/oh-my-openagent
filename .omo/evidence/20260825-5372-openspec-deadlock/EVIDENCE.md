# WHAT WAS TESTED

Issue #5372: child agents deadlock after the OMO-Senpi integration; narrowed framing:
task-identifier resolution blocks the child pipeline.

Root cause (file:line):
- `packages/omo-senpi/src/components/task/dag-runtime.ts` `stoppedAdmission()` returned
  `new Promise(() => undefined)` - a promise that NEVER settles.
- The admission gate keys on the run identifier: when a run id is latched in
  `stoppedAdmissions` (set by `recovery.pauseRunsForShutdown` on session shutdown),
  every `startOwned` for that identifier through the `admissionTaskManager` proxy
  returned the never-resolving promise.
- Consumers that await it: the scheduler wave loop (`packages/senpi-task/src/dag/scheduler.ts`
  `admitAndSettleWave`, `await Promise.allSettled(...)`), recovery's `reconcileNodes`
  (`packages/senpi-task/src/dag/recovery.ts:200`), and everything downstream of
  `whenAdmissionIdle` (`performCancellation`). One latched admission pins the whole
  scheduler forever: the run never terminalizes, `dag wait` never resolves, cancel hangs,
  and node children never start - the reported "child agent deadlock".

Deterministic repro (added regression test, co-located given/when/then):
`packages/omo-senpi/src/components/task/dag-runtime.test.ts`
"#given a run paused for shutdown with a queued dependent wave #when the finished node
settles while the run identifier is latched #then the next-wave admission settles as a
typed denial instead of pinning the pipeline forever"
- two-node serial DAG; pauseForShutdown() latches the run id while the scheduler runs;
  first node settles; scheduler admits the dependent second wave through the latch.

# WHAT WAS OBSERVED

- RED (pre-fix): `runtime.wait(runId)` never resolves; test times out at 5000ms
  ("timed out after 5000ms") - exact deadlock reproduced deterministically.
- Fix: `stoppedAdmission(runId)` now resolves with the typed result both consumers already
  handle: `{ kind: "residency_denied", reason: "dag run \"<id>\" is paused; ..." }`.
  Stale comment on `adoptReentry` updated (the retry-unlatch requirement remains, wording
  no longer describes a hang).
- GREEN (post-fix): run terminalizes `failed`; completed node keeps its output; denied node
  fails with error code `residency_denied`; no child spawns past the latch
  (`runner.handles` length 1). Escape hatch unchanged: `dag retry` clears the latch and
  re-runs failed nodes (existing test "admission is un-latched and the retry completes"
  still green).

Verification results:
- `bun test packages/omo-senpi/src/components/task/dag-runtime.test.ts` -> 17 pass / 0 fail
  (dag-runtime-tests-after.txt)
- `bun test packages/senpi-task/src/dag` -> 243 pass / 0 fail (senpi-task-dag-tests.txt)
- `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` -> exit 0 (tsgo-omo-senpi.txt)
- Full `bun test packages/omo-senpi`: 13 failures, ALL in generated-artifact gates
  (plugin/skills sync, extension bundle shebang, packed plugin artifacts). Proven
  PRE-EXISTING on BASE c7094b8ac via `git stash` of my two files ->
  `bun test packages/omo-senpi/src/skills-sync.test.ts` still fails 7 without my change.
  Cause: this worktree's generated plugin artifacts were never built; the prepare-step
  `build:materialize-frontend` fails in this network-restricted environment (known).

# WHY IT IS ENOUGH

- The failing-first test reproduces the exact deadlock class from the issue (identifier-
  latched admission blocking the child pipeline) deterministically, without timing flake:
  pre-fix it can only time out; post-fix it settles and asserts the full post-state.
- Both `startOwned` consumers (scheduler wave loop, recovery reconcileNodes) already defer
  `residency_denied`, so the fix makes every latched admission settle through EXISTING
  typed paths - no new control flow introduced. Cancellation (`whenAdmissionIdle`) is
  unpinned as a direct consequence.
- The dag suite (243 tests) plus the assembled-runtime suite (17) cover pause/resume/
  retry/amend/cancel/wait around the changed seam; typecheck is clean.

# WHAT WAS OMITTED

- Live Senpi QA driver (`task-e2e.mjs` / team drivers): not runnable here - the senpi
  binary path and network materialization are unavailable in this environment; the change
  is covered by the assembled-runtime harness which drives the real `createDagRuntime`
  composition over scripted children.
- Full repo `bun test` root suite: out of scope for an omo-senpi-scoped seam; scoped
  package suites + typecheck run instead.
- No secrets, tokens, or env dumps are present in this evidence; captured outputs are
  test-runner logs only.

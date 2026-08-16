# QA Evidence: test flake hardening (beyond the reflection time bomb)

Companion to `.omo/evidence/20260816-reflection-completion-time-bomb/`. Three additional
flake classes were root-caused from dev CI history and local full-suite runs.

## 1. auto-update-checker: cross-file module-mock leak

- WHAT WAS TESTED: dev CI history (test job, Aug 7 run) shows
  `auto-update-checker/checker > getLatestVersion` failing with `Received: "3.0.1"` -
  exactly the value returned by the `mock.module("./checker/latest-version")` factory in
  the sibling `hook.test.ts`, proving the module mock was active while `checker.test.ts`
  ran. That mock was DEAD WEIGHT: every hook test injects `runBackgroundUpdateCheck`
  through the deps seam, so nothing in the executed paths consumed the mocked module.
  The second mock (`./hook/deferred-startup-check`) existed only because `hook.ts` called
  `scheduleDeferredStartupCheck` directly instead of through its deps.
- FIX: added an optional `scheduleDeferredStartupCheck` seam to `AutoUpdateCheckerDeps`
  (default binds the real implementation; older injected-deps callers keep working) and
  removed BOTH `mock.module` calls plus the preserve/restore lifecycle from
  `hook.test.ts`. The leak class is structurally gone: no module mock exists to leak.
- OBSERVED: `bun test packages/omo-opencode/src/hooks/auto-update-checker/` -> 81 pass /
  0 fail; explicit hook-before-checker ordering run -> 15 pass / 0 fail. (In-place repro
  of the historical ordering was not achievable locally because bun orders files itself;
  the fix removes the hazard rather than racing the order.)

## 2. senpi-task: process-global task-id floor poisoning

- WHAT WAS TESTED: dev CI history shows `TaskManager claim characterization` failing with
  `Expected: "st_02387198" / Received: "st_deadbf0a"`. `packages/senpi-task/src/state/id.ts`
  keeps `lastTaskIdValue` process-global (intentional: monotonic ids), and
  `syncTaskIdFloor` raises it from ANY store record - so fixture files that persist
  `st_deadbeef`-scale ids poison every later clock-derived allocation in unrelated test
  files, dependent on file execution order.
- FIX: `_resetTaskIdFloorForTesting()` in `id.ts`, called from the root `test-setup.ts`
  `beforeEach` (mirrors the existing `_resetForTesting` family). Production never calls it.
  New regression test `id-floor-isolation.test.ts` poisons the floor in one test and
  asserts the next test allocates clock-derived again.
- OBSERVED before/after: the same regression test run against the OLD test-setup (clean
  origin/dev checkout) fails with `Received: "st_deadbef1"` (the exact CI failure class);
  with the fix it passes (2/2). Full `bun test packages/senpi-task` -> 1600 pass / 0 fail.

## 3. task RPC launch parity: hermetic env + self-diagnosing assertion

- WHAT WAS TESTED: `task RPC launch profile parity ... model is visible without
  credentials` failed intermittently (today's PR CI ubuntu run at 2077ms, and one local
  full-suite run at 1461ms) while passing in isolation and in 4 subsequent instrumented
  full-suite runs. The failure means the catalog probe child ran but the admission
  rejected; the assertion (`await expect(admission).resolves...`) swallowed the
  rejection detail, so the CI log carries no cause.
- FIX (two directed hardenings, since the repro would not reappear under 4 full-suite
  attempts): (a) the probe env is now snapshotted at MODULE LOAD (`moduleLoadEnv`)
  instead of `{...process.env}` mid-test - several suites prepend fixture bin dirs to
  PATH and leaked async cleanup can mutate env mid-test, which changes which senpi
  launcher the probe resolves; (b) the assertion awaits the admission directly so any
  future rejection prints the full `RunnerError` message, which embeds the probe's
  stderr tail - the next occurrence self-reports its cause instead of
  "Promise { <rejected> }".
- OBSERVED: parity file 2 pass / 0 fail; full-suite stability runs below.

## Stability proof

- run1 (time-bomb fix only): full `bun test` -> 15486 pass / 41 skip / 0 fail.
- runs 2-4 (instrumented origin/dev-equivalent worktree): parity passed all three; only
  the 2 known time-bomb failures appeared (that worktree predates the fix by design).
- stability runs a/b/c (all fixes): see `stability-runs.txt` (appended after the loop).
- Checkout-path control: `bun test packages/omo-opencode/src/hooks` standalone fails 44
  on `/workspace` and 48 on ANY worktree path including a pristine `origin/dev` control
  worktree - a pre-existing subset-run artifact, not caused by these changes; the
  supported gate is the full single-process `bun test`, which is green.

## WHAT WAS OMITTED

- No secrets in any captured output. Temporary parity debug instrumentation was reverted
  after the reproduction attempts; the committed diagnostic is the assertion change only.

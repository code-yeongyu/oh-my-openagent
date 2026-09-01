# QA Evidence - Fix #5167 (Momus exit not propagated; parent hangs)

Date: 2026-08-25
Branch: issue/5167-momus-exit-not-propagated (base c7094b8ac)
Worktree: task-owned temporary checkout

## WHAT WAS TESTED

Surface: `packages/senpi-task` in-process child runner turn settlement
(`src/runners/in-process/child-handle.ts`) - the seam between a child subagent
session (e.g. Momus, pinned in-process) and the parent's blocking `task()` call.

Commands:
- RED (before fix): `bun test packages/senpi-task/src/runners/in-process/child-handle-outcome.test.ts`
- GREEN (after fix): same command
- Scoped regression: `bun test packages/senpi-task/src/runners packages/senpi-task/src/tools/task packages/senpi-task/src/manager`
- Typecheck: `bunx tsgo --noEmit -p packages/senpi-task/tsconfig.json`
- CI repair: `bun test packages/omo-opencode/src/shared/markdown-link-audit.test.ts`
- Ubuntu shard: `bun test packages/omo-opencode packages/memory-core`

Behavior under test: when an in-process child's agent loop exits (senpi emits
`agent_end`, logged as "exiting loop") while its `prompt()` promise never
resolves, the tracked turn must settle from the session event stream so
`waitForOutcome()` -> record terminal transition -> `manager.waitFor()` ->
parent `task()` result completes. This is the exact hang reported in #5167:
Momus exited at step 3, the parent's task() never returned, messageCount froze,
no timeout, no error.

## WHAT WAS OBSERVED

RED (fix reverted state = new tests against old code):
- 3 new tests timed out after 20000ms each:
  1. agent_end emitted + prompt() never resolves -> waitForIdle never settles (the #5167 hang)
  2. agent_end with no assistant output + prompt() never resolves -> never settles
  3. abort() then agent_end + prompt() never resolves -> never settles
- Existing 4 tests passed.
- Full red run: 6 pass / 3 fail (timeouts), ~75s wall clock.

GREEN (after fix):
- All 9 tests pass in <1s: bun-test-after.txt
  - agent_end settles completed with this turn's assistant text
  - agent_end with no output settles error ("no assistant output"), never hang
  - abort + agent_end settles cancelled (mirrors rpc handle semantics)
  - willRetry=true agent_end does NOT settle early (runtime fallback keeps the turn)
  - stray agent_end after prompt-resolution settlement is ignored; followUp revive still works
- Scoped regression: 601 pass / 1 skip / 0 fail across 96 files (~20s).
- tsgo typecheck: exit 0, no errors.

CI repair (2026-08-27):
- The targeted markdown audit initially identified this document's former
  machine-local worktree path as its sole offender.
- The portable worktree description above removes that non-product CI failure.
- The markdown audit now passes: 16 pass / 0 fail in 1181ms.
- The Momus outcome regression remains green: 9 pass / 0 fail in 730ms.
- The local Bun 1.4 full Ubuntu shard command exposed five unrelated
  auto-update-checker mock-isolation failures; its focused checker file passes
  5/5. The original CI run's only failure was this markdown audit.

Fresh audit ledger (2026-08-27):
- Wave 1 scope: complete `origin/dev...HEAD` change set, local CI-evidence
  repair, in-process runner settlement, regression tests, and generated Senpi
  bundle. Commands: `git diff --check`, full diff review, focused regression,
  typecheck, and markdown audit. Findings: P0=0, P1=0, P2=0, P3=0, noise=the
  unrelated local auto-update-checker suite interaction described above.
- Wave 2 scope: the same complete vertical plus terminalization callers,
  retry/abort/revive paths, and evidence portability. Commands: `git diff
  --check` and fresh full-diff review. Findings: P0=0, P1=0, P2=0, P3=0,
  noise=unchanged unrelated local auto-update-checker suite interaction.

Isolation: pure unit tests over controllable ChildSession fakes; no real senpi
binary, no network, no writes outside the repo temp/test dirs.

## WHY IT IS ENOUGH

The failing-first tests reproduce the reported failure mode deterministically at
the exact seam where the parent blocks (child-handle settlement cell). The fix
mirrors the already-shipped RPC-handle settlement semantics (`agent_end` with
`willRetry === false` settles the turn; first settlement wins), so both runners
now share one contract. The scoped suites cover every consumer of the changed
handle (manager outcome tracking, foreground wait, task tool) and the adversarial
invariants remain green. Remaining risk: a senpi build whose in-process session
never emits `agent_end` AND never resolves prompt() would still hang; that
requires a senpi-core fix (upstream surface), out of scope for this repo-side
minimal change.

## WHAT WAS OMITTED

No secrets, tokens, auth headers, or env dumps were produced by these tests;
nothing to redact. Live end-to-end driver runs (task-e2e.mjs through a real
senpi binary) were not executed here: no senpi binary provisioning in this
environment and the unit seam fully determines the fixed behavior; the live lane
is covered by the package's existing e2e drivers on CI.

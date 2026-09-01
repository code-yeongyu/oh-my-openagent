# senpi-task residency retention evidence

## Scope

Branch: `fix/senpi-mem-task-residency`  
Base: `origin/dev` at `d50518d45`  
Commits: `e7768de54`, `3fa909e17`, `cd157168d`

## Fixes

1. **Idle resident reclamation (3.1):** terminal residents owned by this process (or backed by a local live handle) are evicted after `15 minutes` without an `updated_at` touch. The choice is shorter than the existing `24 hour` record TTL so the durable record remains available to `task_output` while the large in-process `AgentSession` is released. An unref'd 15-minute sweep also invokes `cleanupExpiredRecords`; its returned disposer is called during `session_shutdown`. Candidates are re-read immediately before teardown and pending sends are skipped.
2. **Bounded default (3.2):** default residency is now `min(16, max(8, parallelism * 2))`; parallelism 14 resolves to 16 rather than 42. Per-process counting is not changed: the existing lifecycle is composed per session and no host-wide shared residency registry seam exists. This is documented as follow-up.
3. **Pending sends (3.5):** the steering engine now tracks in-flight steer/revive operations and exposes them together with durable `pending_steering`. The manager and omo-senpi residency bridge use that state for eviction checks.

## TDD evidence

- **RED:** the first test commit (`e7768de54`) added the regression coverage before implementation. The idle test captured the pre-fix behavior (terminal resident remained `resident` and undisposed), the config test captured the old parallelism-14 result of 42, and the adapter test required `hasPendingSends === true` for a queued message while the bridge returned the hard-coded false.
- **GREEN:** implementation commit (`3fa909e17`) changes the idle test to assert eviction/disposal and the config assertion to 16. The bundle check passed against the regenerated artifacts.
- The initial macOS harness attempt was blocked because `/tmp/omo-mac-test2.mjs` was absent. After the harness was recreated, the prescribed command completed successfully:

  `MAC_TEST_TIMEOUT_S=2400 bun /tmp/omo-mac-test2.mjs fix/senpi-mem-task-residency -- packages/senpi-task`

  Result: **1773 passed, 1 skipped, 0 failed** across 252 files; exit 0. Local Bun tests were not run, as forbidden by task scope.

## Bundle verification

`bun install` completed with Bun 1.4.0.  
`node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` passed after bundle regeneration. Tracked `omo.js` and `omo-task.js` artifacts are included in commit `cd157168d`.

## Explicit follow-ups

- Matrix/Lane 3.3: wire DAG pruning and cache run listings.
- Matrix/Lane 3.4: reduce snapshot fan-out serialization churn.
- Matrix/Lane 3.6: sweep orphaned omo-family processes.
- Suspect #4: remove or cap curated-agent in-process pinning.
- Introduce a host-owned process-wide residency registry/cap for multi-session hosts.

## Working tree / remote

The worktree is clean after push. Branch push succeeded to `origin/fix/senpi-mem-task-residency`. PR is open and the prescribed remote macOS test is green.

## Mutation-proof overlapping-send verification

- **Mutation RED:** temporarily changed `pendingSends` from `Map<string, number>` back to the old `Set<string>` implementation in commit `3507fb6b4`, pushed it, and ran the serialized remote scope. The capture was:
  - `2 tests failed`
  - in-process overlap: expected pending state `true` after send #1 settled, received `false`
  - rpc overlap: expected pending state `true` after send #1 settled, received `false`
  - total: `1781 pass`, `1 skip`, `2 fail`
- **Restored GREEN:** reset to the counter implementation at `bc722b447`, pushed it, and reran the same remote scope. The capture was `1783 pass`, `1 skip`, `0 fail`.

The corrected test uses independent completion gates, awaits send #1 before asserting pending state remains true, then releases and awaits send #2 before asserting false. No sleeps or real timers are used.

## Eviction/send race blocker correction

The race fix was implemented in commits `06d3a81f5` (RED tests), `92f53583a` (implementation), and `52843c1d7` (rebased bundle regeneration; current dev included PR #7533). Eviction now acquires a synchronous per-task claim before teardown awaits; sends/revives acquire the same task arbitration and receive a typed `not_continuable` refusal when eviction owns it. In-flight sends use a per-task counter, and sweep failures log the task id and error.

The required serialized verification at SHA `fd1aa8f54` passed with **1783 passed, 1 skipped, 0 failed**. The later type-narrowing correction and bundle regeneration are at `34567b637` and `52843c1d7`; the current rerun at `52843c1d7` also passed **1783 passed, 1 skipped, 0 failed**.

## Follow-up CI correction

The first Ubuntu full-suite run exposed two branch-caused issues: the idle test title still used RED-era wording, and its fake clock (`960,000`) was earlier than the fixture timestamp (`1,000,000`), so the record was correctly retained. The test now uses the contract title, an injected scheduler (no real timer), and `1,000,000 + 16 minutes` as its injected clock. The scheduler assertion pins the 15-minute interval. The manager registry fixture was also completed for typecheck.

After regenerating both plugin bundles on top of the rebased `origin/dev` (including PR #7533's `omo.js`), `build-extension.mjs --check` passed. The required serialized remote command completed at SHA `fd1aa8f54` with **1783 passed, 1 skipped, 0 failed**.

## Eviction/send race TDD

- **RED:** commit `06d3a81f5` added deterministic regressions for (a) a steer beginning after the final idle observation while eviction is claimed, (b) a revive arriving during claimed teardown, and (c) overlapping sends where the first completion must not clear pending state while the second remains active.
- **GREEN:** commit `92f53583a` implements the per-task mutual claim, typed refusal, counted pending sends, and sweep failure logging. The subsequent bundle commit is `fd1aa8f54` after rebasing onto current `origin/dev`.
- The replacement PR CI run passed all required checks: Ubuntu test shards 1/2 and 2/2, macOS and Windows test shards, typecheck, build, and Senpi compatibility on Ubuntu/macOS/Windows.

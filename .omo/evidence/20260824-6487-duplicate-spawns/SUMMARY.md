# 20260824-6487-duplicate-spawns — QA evidence

## WHAT WAS TESTED

- Command: `bun test packages/omo-opencode/src/tools/delegate-task/sync-task.test.ts -t "superseded session is aborted"` (RED, pre-fix) — artifact: `red-test-output.txt`.
- Command: `bun test packages/omo-opencode/src/tools/delegate-task/ packages/omo-opencode/src/features/background-agent/fallback-retry-handler.test.ts packages/omo-opencode/src/features/background-agent/abort-with-timeout.test.ts packages/omo-opencode/src/features/background-agent/task-poller.test.ts` (GREEN, post-fix) — artifact: `gate-scoped-green.txt` (561 pass / 0 fail, 45 files).
- Command: `bun run typecheck` (tsgo --noEmit root + script + all workspace packages) — artifact: `typecheck-green.txt`, exit 0.
- Surface driven: the sync delegate-task fallback-retry path
  (`runSyncTaskLoop` in `packages/omo-opencode/src/tools/delegate-task/sync-task-runner.ts`)
  via the deps-injected regression test in `sync-task.test.ts`, which replays the
  exact production sequence: create session -> send prompt -> retryable poll error
  ("Forbidden: Selected provider is forbidden") -> fallback model -> replacement session.

## WHAT WAS OBSERVED

- RED (pre-fix): the superseded child session was never aborted and never added to
  `handedBackSyncSessions`; the loop created the replacement while the first child
  was still live. This is issue #6487's signature: two sessions for one `task()`
  invocation, both initialized with the identical prompt.
- GREEN (post-fix): the superseded session is aborted (bounded, via the shared
  `abortWithTimeout`) BEFORE the replacement session is created, and it is recorded
  in `handedBackSyncSessions` so `todo-continuation-enforcer` cannot re-awaken it.
  Ordering is asserted on an event timeline (`abort:ses_superseded` precedes
  `create:ses_replacement`). All pre-existing retry/metadata/cleanup assertions in
  the suite still pass unchanged.

## WHY IT IS ENOUGH

- The fix restores the invariant from the issue's Expected Behavior section:
  "the previous attempt [is] aborted cleanly before a new one starts. Under no
  circumstances should two active subagent sessions run in parallel." The
  background path already had this property (`fallback-retry-handler.ts:230-232`
  awaits `abortWithTimeout` before re-queueing); the sync path now matches it,
  and the ordering test pins that property so it cannot regress silently.
- The scoped suites cover every consumer of the changed pieces: the whole
  delegate-task directory (sync/background/continuation/unstable executors,
  lifecycle, poller, creator), plus the background-agent suites that exercise
  `abortWithTimeout` after its client parameter was widened to a structural type
  (`AbortCapableClient`) with no behavior change.
- Root cause audit (delegated exploration + manual read of `tools.ts`,
  `executor.ts` branches, retry hooks) found no double-delivery/replay entry
  point at the tool layer: `tools.ts` routes each invocation through exactly one
  executor branch; `delegate-task-retry`, `task-resume-info`, and
  `empty-task-response-detector` hooks are text-only. The verified duplicate
  producer is the sync re-create-without-abort path fixed here.

## WHAT WAS OMITTED

- No live-harness repro of a real provider error mid-sync-task: triggering a real
  429/quota error inside a live OpenCode subagent session is not deterministically
  reproducible in CI or locally; the deps-injected regression test reproduces the
  identical code sequence instead. Residual risk: an abort endpoint behaving
  differently in a real server (slow/hanging) is covered by `abortWithTimeout`'s
  existing bounded-timeout behavior, which is unit-tested in
  `abort-with-timeout.test.ts` and battle-tested by the background path.
- Raw test output truncated to pass/fail summaries in artifacts; no secrets, env
  dumps, tokens, or auth headers are present in any evidence file.

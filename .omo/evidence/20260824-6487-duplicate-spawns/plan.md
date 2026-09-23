# Plan: Fix #6487 duplicate parallel subagent sessions (sync fallback retry)

## Root cause (verified by reading code)

- `packages/omo-opencode/src/tools/delegate-task/sync-task-runner.ts:180-196`
  On a retryable poll error with a fallback model available, `runSyncTaskLoop`
  calls `cleanupRetrySession(activeSessionID)` and then creates a REPLACEMENT
  session via `deps.createSyncSession`. `cleanupRetrySession` ->
  `cleanupSyncSessionSideEffects` (`sync-session-lifecycle.ts:57-66`) only clears
  in-process bookkeeping (set membership, bootstrap map, category registry); it
  NEVER aborts the superseded session. That session already received the full
  task prompt and keeps running -> two live subagent sessions for ONE `task()`
  invocation. Matches the issue signature: two session IDs created ~2s apart
  (send prompt -> 1s poll -> error -> second create), identical prompt.
- Aggravator: the superseded session is never added to `handedBackSyncSessions`,
  so `todo-continuation-enforcer` can re-awaken it on `session.idle`, extending
  the overlap to many minutes (15m51s overlap in the issue report).
- Background path is NOT affected: `fallback-retry-handler.ts:230-232` awaits
  `abortWithTimeout(previousSessionID)` before re-queueing the retry attempt.
- No double-delivery/replay entry point exists at the tool layer: `tools.ts`
  branches are if/return (one executor per invocation); retry hooks
  (`delegate-task-retry`, `task-resume-info`, `empty-task-response-detector`)
  are text-only. So the fix targets the verified re-create-without-abort path,
  not a speculative idempotency map.

## Changes

1. `packages/omo-opencode/src/features/background-agent/abort-with-timeout.ts`
   Widen the client parameter to a minimal structural type
   (`session.abort({path:{id}})`) so delegate-task's `OmoAgentClient` can reuse
   the helper. No behavior change for existing background-agent callers.
2. `packages/omo-opencode/src/tools/delegate-task/sync-task.ts`
   `cleanupRetrySession` becomes async: bookkeeping cleanup, then mark the
   superseded session handed-back (`handedBackSyncSessions.add`) and
   `await abortWithTimeout(client, id).catch(() => {})` so the replacement is
   never created while the old child may still be active.
3. `packages/omo-opencode/src/tools/delegate-task/sync-task-runner.ts`
   `cleanupRetrySession` input type -> `(id: string) => Promise<void>`;
   `await` it before creating the retry session (ordering guarantee).
4. `packages/omo-opencode/src/tools/delegate-task/sync-task.test.ts`
   Failing-first regression test (given/when/then): one invocation hits a
   retryable poll error -> the superseded session must be aborted AND recorded
   in `handedBackSyncSessions` BEFORE the replacement session is created;
   exactly one live child remains.

## Verification

- RED: new test fails on current code (no abort, not handed back).
- GREEN after fix: `bun test packages/omo-opencode/src/tools/delegate-task/sync-task.test.ts`
  plus scoped suites (`background-task.test.ts`, `fallback-retry-handler.test.ts`,
  `abort-with-timeout.test.ts`, `sync-session-lifecycle.test.ts`).
- `bun run typecheck` (repo gate) or scoped tsgo for touched package.
- Evidence under `.omo/evidence/20260824-6487-duplicate-spawns/`.

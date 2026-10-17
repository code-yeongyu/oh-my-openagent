# Plan — issue #6303: atlas boulder-continuation loops forever on failed compaction (missing #6109 guards)

## Root cause (verified against dev source a17b91cdc, not from memory)

The `todo-continuation-enforcer` hook gained compaction/API-error guards in #6109, but the
atlas boulder path never inherited them. Three concrete gaps:

1. `atlas/event-handler.ts` `session.error` (non-abort) unconditionally calls
   `handleAtlasSessionIdle`, which re-injects the BOULDER CONTINUATION directive. A
   non-retryable Anthropic 400 (compaction `tool_use`/`tool_result` split) therefore
   re-fires injection every cycle: inject -> opencode retries broken compaction -> 400 ->
   session.error -> handleAtlasSessionIdle -> cooldown (5s) already elapsed -> inject again.
2. `atlas/types.ts SessionState` has no `tokenLimitDetected` / `unrecoverableErrorDetected`
   flags and no gate anywhere on the atlas path honors them.
3. `atlas/idle-continuation.ts` never inspects latest session messages: an errored
   compaction marker as the latest message does not stop injection. Additionally,
   `injectBoulderContinuation` resets `promptFailureCount = 0` when the prompt dispatch is
   accepted, so async turn failures (which happen after dispatch) never accumulate.

## Fix design (mirror #6109 semantics onto atlas, reuse enforcer classifiers)

1. NEW `hooks/shared/session-error-info.ts`: move `extractSessionErrorInfo()` verbatim from
   `todo-continuation-enforcer/handler.ts`; handler imports it from shared (both hooks need
   identical event-payload parsing; repo law: reach for shared/ before duplicating).
2. `todo-continuation-enforcer/index.ts`: barrel-export `isTokenLimitError`,
   `isUnrecoverableRequestError`, `isLastAssistantMessageAborted`, and type
   `MessageWithInfo` for cross-hook reuse.
3. `atlas/session-error-guard.ts` (NEW): `classifySessionError(error)` ->
   `{ info, isAbort, isTokenLimit, isUnrecoverable }` using shared extraction + atlas
   `isAbortError` + enforcer detectors.
4. `atlas/types.ts`: add `tokenLimitDetected?`, `unrecoverableErrorDetected?`.
5. `atlas/event-handler.ts`:
   - `session.error`: classify once. abort -> existing path unchanged. token-limit or
     unrecoverable -> set flag, bump `promptFailureCount`/`lastFailureAt`, set
     `stalledContinuationReason` (surfaces the error), clear pending retry timer, log,
     RETURN without calling `handleAtlasSessionIdle` (this breaks the loop).
   - `message.updated` role=user: clear both flags (parity with enforcer genuine-user reset).
6. `atlas/idle-event.ts`: early-return gates for both flags after the
   `stalledContinuationReason` check.
7. `atlas/idle-continuation.ts`:
   - `scheduleRetry` timer: skip when either flag set.
   - `injectContinuation`: fetch latest messages (own try/catch; fetch failure -> skip,
     mirroring enforcer), skip when last assistant message aborted or latest message is a
     compaction marker (`isCompactionMessage` from shared/compaction-marker). No retry is
     scheduled for these skips so no silent timer spin.

Recovery story: successful compaction fires `session.compacted` -> existing
`cleanupSession` wipes state -> normal operation. A genuine user message clears the flags.
Plan change clears the stall reason via existing `resetStallStateForPlanChange`.

## TDD

RED first (`atlas/compaction-loop-guard.test.ts`, full-hook harness mirroring index.test.ts):
- given incomplete boulder plan #when non-retryable compaction-400 session.error #then no
  continuation prompt dispatched + subsequent idle stays silent (loop broken).
- same for token-limit error payload.
- given latest message is an errored compaction marker #when idle #then no injection.
- transient RuntimeError still injects immediately (regression guard for runtime retry).
- genuine user message after stall clears flags so a healthy session can resume.

Then GREEN implementation, focused tests, gates twice.

## Verification

- Focused: `bun test packages/omo-opencode/src/hooks/atlas packages/omo-opencode/src/hooks/todo-continuation-enforcer`
- Typecheck: `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`
- `git diff --check`, hygiene scan on changed paths.
- Gates run TWICE consecutively over identical final tree.

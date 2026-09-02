# Plan: Fix issue #6751 - runtime_fallback resets fallback position mid-cycle

Worktree: ../oom-wt-6751 (branch fix/6751-runtime-fallback-position-reset, base origin/dev @ 8c57e463e)

## Root causes (mapped from full vertical read)

Vertical: hook.ts composes event-handler.ts (session lifecycle), message-update-handler.ts
(assistant error parts), session-status-handler.ts (provider retry signals),
chat-message-handler.ts (chat.message model override + manual-change detection),
fallback-state.ts (position bookkeeping), fallback-retry-dispatcher.ts (prepare + dispatch),
auto-retry-dispatch.ts (prompt-gate dispatch, generation token = state object identity),
auto-retry-abort.ts (abort + internallyAbortedSessions marking), auto-retry-timeout.ts,
first-prompt-watchdog.ts.

1. PRIMARY (vector A): `resetRetryState` in event-handler.ts replaces the session
   FallbackState with a fresh `createFallbackState(originalModel)`, wiping `fallbackIndex`,
   `failedModels`, `attemptCount`, `currentModel` and `pendingFallbackModel`. It runs on:
   - every `session.stop` (handleSessionStop) with no discrimination for echoes of our own aborts;
   - `session.idle` while the session is in `cancelledSessions` (handleSessionIdle);
   - abort-classified `session.error` without the internal flag (legitimate user cancel; keep).
   During a fallback hop driven by an abort (session.status retry-signal override,
   message.updated quota fallback, session.timeout), auto-retry-abort marks
   `internallyAbortedSessions`, but the resulting stop/idle echo events never check that flag
   and wipe the just-prepared state. The next failure re-prepares from index 0 with empty
   cooldowns: repeat of already-failed models and multi-minute stall.
2. SECONDARY (vector B): chat-message-handler "Detected manual model change" resets state
   whenever requestedModel != currentModel unless `pendingFallbackModel` matches. After any
   mid-cycle wipe, OMO's own marker-carrying retry dispatch (model = prepared fallback)
   finds `pendingFallbackModel` cleared and is misread as a manual change; state is replaced
   with `originalModel` = the fallback model. The next failure then walks the chain from
   index -1 with empty cooldowns and selects chain[0] - the just-failed primary - BACKWARD.

## Invariant to preserve

Fallback position (`fallbackIndex`, `failedModels`) only ever moves forward within a cycle
(prepareFallback only selects candidates at index > current, skipping cooldown/equivalent).
Full position resets happen ONLY on legitimate new-cycle boundaries:
- genuine user stop / external abort (no internal-abort flag),
- genuine manual model change (non-marker chat.message with mismatched model),
- session deletion / plugin dispose.

## Changes (minimal, two files)

### 1. packages/omo-opencode/src/hooks/runtime-fallback/event-handler.ts
- handleSessionStop: before any mutation, if `deps.internallyAbortedSessions.has(sessionID)`
  -> log "ignoring session.stop echo of internal fallback abort" and return. No
  cancelledSessions.add, no resetRetryState, no duplicate abort.
- handleSessionIdle cancelled branch: same guard before resetRetryState -> log + return.
- Unchanged: resetRetryState body, external-abort reset path (pinned by existing tests),
  handleSessionDeleted cleanup, normal-idle transient cleanup.

Flag lifetime note: only handleSessionError's abort branch consumes the flag today (pinned);
stop/idle guards only read it. Residual risk of a lingering flag when opencode emits no
abort-classified session.error after our abort is pre-existing and unchanged.

### 2. packages/omo-opencode/src/hooks/runtime-fallback/chat-message-handler.ts
- After the existing pendingFallbackModel-match early return, add a marker guard:
  if `isRuntimeFallbackRetryTextParts(output.parts)` (import from
  src/shared/runtime-fallback-retry-marker.ts) -> this is our own retry dispatch, never a
  manual change -> return without resetting. Log when requestedModel mismatches currentModel
  so residual races stay observable. No state mutation in this guard (the dispatched request
  already carries its model payload; adopting or rewinding currentModel here could corrupt
  forward-only bookkeeping).

## Tests (TDD RED -> GREEN)

event-handler.test.ts additions:
- T1 stop echo preserved: given mid-cycle state (idx=1, failed={primary}, pending set) +
  internal flag, when session.stop, then all position fields intact, no abort call.
- T2 idle echo preserved: same given, when session.idle, then fields intact.
- T3 forward-only progression across echoes: given chain [zai/p, go/a, zen/b] with primary
  as chain[0] (issue shape), drive error(503 on primary) -> status retry signal on go/a ->
  echo stop+idle+abort-error -> error(503 on go/a); then next prepare must NOT re-dispatch
  go/a or zai/p (chain exhausted at zen/b -> dispatcher not called again).
- T4 regression guard: genuine user stop (no flag) still wipes position (explicit field
  assertions; complements existing dedupe-key test).

chat-message-handler.test.ts additions:
- T5 marker dispatch mismatch does not reset: given post-wipe-shaped state + output.parts
  carrying OMO_RUNTIME_FALLBACK_RETRY_MARKER + requestedModel != currentModel, then same
  state object identity, originalModel/fallbackIndex/failedModels unchanged.
- T6 marker dispatch matching pending still consumes pending (existing cleanup preserved).

End-to-end monotonicity pin (runtime-fallback-position.test.ts, new):
- T7 real createRuntimeFallbackHook + fake client: created(zai/p, sisyphus) ->
  error 503 -> promptAsync#1 go/a -> status retry(go/a) marks internal abort via REAL
  abortSessionRequest -> promptAsync#2 zen/b -> echo stop/idle/error -> error 503 ->
  assert promptAsync models == [go/a, zen/b] exactly (never zai/p again), state.idx == 2,
  originalModel still zai/p. RED on current code (re-dispatches go/a after wipe).

## Gates (twice consecutively over final tree)

1. bun test packages/omo-opencode/src/hooks/runtime-fallback/ (+ adjacent:
   packages/omo-opencode/src/shared/prompt-async-route-audit.test.ts and any suite importing
   runtime-fallback modules) - all pass, multiple consecutive runs.
2. bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json -> exit 0.
3. GIT_MASTER=1 git diff --check clean.
4. Hygiene scan: no new as any / ts-ignore / ts-expect-error / non-null assertions.

## Isolated QA (/tmp/opencode/issue-6751/)

Event-sequence simulation script driving the real handlers through the reported stalled
cycle and the working cycle, asserting monotonic forward-only movement and no multi-minute
stall; includes legit new-cycle reset regression guards. Sandbox XDG env; no real config or
session stores touched.

## Explicitly out of scope (adjudicated)

- Cooldown "skip last-failed even if map lost" heuristic (issue suggestion 3): unnecessary
  once vectors A+B are closed - the map is no longer lost; extra heuristics risk breaking
  restore-primary flows. Rejected for minimality.
- Prompt-async gate "active" rejection behavior (tertiary symptom): owned by the shared gate
  and issues #6637/#5784 family; the gate already queues ("Session active, queueing fallback
  dispatch"). Not touched here.
- model-fallback hook: independent system, unaffected.

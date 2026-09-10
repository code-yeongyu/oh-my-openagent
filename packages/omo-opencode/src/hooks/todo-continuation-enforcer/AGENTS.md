# src/hooks/todo-continuation-enforcer/ (Boulder Continuation Mechanism)

**Generated:** 2026-07-17 (7d664b96b)

## OVERVIEW

36 files (18 implementation + 17 tests, ~6.7k LOC). The "boulder" Continuation Tier hook: forces Sisyphus to keep rolling when incomplete todos remain. Fires on `session.idle`, injects a continuation prompt after a 2s countdown toast.

## HOW IT WORKS

```
session.idle
  → Is main session (not prometheus/compaction/plan)? (DEFAULT_SKIP_AGENTS)
  → No abort detected recently? (ABORT_WINDOW_MS = 3s)
  → Not already handed back / recovering / token-limited / unrecoverable?
  → No pending question and no pending internal continuation response?
  → Compaction guard disarmed? (compaction-guard.ts, COMPACTION_GUARD_MS = 60s)
  → Todos still incomplete? (todo.ts)
  → No background tasks running (incl. pending parent wake)?
  → Cooldown passed? (CONTINUATION_COOLDOWN_MS = 5s, exponential backoff)
  → Failure count < max? (MAX_CONSECUTIVE_FAILURES = 5)
  → Not paused at turn boundary? (continuationBlockReason)
  → Start 2s countdown toast → inject CONTINUATION_PROMPT
```

## TURN-BOUNDARY PAUSE

After injecting `CONTINUATION_PROMPT` the hook watches the next turn before
rearming. `awaitingPostInjectionProgressCheck` is set on injection; assistant
activity (`message.updated` / `message.part.updated` / `message.part.delta` with
role=assistant, or `tool.execute.before/after`) marks `continuationResponseObserved`.

On the next `session.idle`, `trackContinuationProgress` resolves the pause:

- No progress + `continuationResponseObserved` set: `continuationBlockReason = "directive-response"`. The assistant answered without advancing todos, so rearming stops.
- Genuine user message inside the accepted-continuation window: `continuationBlockReason = "user-interruption"`. Synthetic/internal split messages (continuation echo, system directives) are filtered out. When the user `message.updated` event lacks parts, classification is deferred to `message.part.updated` by stashing `pendingUserMessageID`.

While `continuationBlockReason` is set, `handleSessionIdle` and `continuation-injection.ts` skip. It is cleared on real todo progress, abort, or a fresh injection.

## KEY FILES

| File | Purpose |
|------|---------|
| `handler.ts` | `createTodoContinuationHandler()`: event router. Handles `session.error` (abort + token-limit detection) and `session.compacted`; delegates `session.idle` and the message lifecycle to idle/non-idle handlers |
| `idle-event.ts` | `handleSessionIdle()`: main decision gate for `session.idle` |
| `non-idle-events.ts` | `handleNonIdleEvent()`: `message.updated` / `message.part.updated` / `message.part.delta` and `tool.execute` handlers; classifies user interruptions vs assistant turns for the turn-boundary pause |
| `session-state.ts` | `SessionStateStore`: per-session failure/abort/cooldown/progress state |
| `todo.ts` | Check todo completion status via session store |
| `countdown.ts` | 2s countdown toast before injection |
| `abort-detection.ts` | Detect MessageAbortedError / AbortError |
| `compaction-guard.ts` / `stagnation-detection.ts` | Post-compaction epoch guard; stop after `MAX_STAGNATION_COUNT` idle turns |
| `pending-question-detection.ts` / `resolve-message-info.ts` | Skip on an unanswered Question; resolve latest agent/model + compaction markers |
| `token-limit-detection.ts` / `unrecoverable-request-error.ts` | Classify non-retryable session errors |
| `continuation-injection.ts` | Build + inject CONTINUATION_PROMPT into session |
| `message-directory.ts` | Temp dir for message injection exchange |
| `constants.ts` | Timing constants, CONTINUATION_PROMPT, skip agents |
| `types.ts` | `SessionState`, handler argument types |

## CONSTANTS

```typescript
DEFAULT_SKIP_AGENTS = ["prometheus", "compaction", "plan"]
CONTINUATION_COOLDOWN_MS = 5_000      // 5s base, exponential backoff per failure
MAX_CONSECUTIVE_FAILURES = 5          // Then 5min pause (exponential backoff)
FAILURE_RESET_WINDOW_MS = 5 * 60_000  // 5min window for failure reset
COUNTDOWN_SECONDS = 2
ABORT_WINDOW_MS = 3000                // Grace after abort signal
COMPACTION_GUARD_MS = 60_000          // Guard window after a compaction
MAX_STAGNATION_COUNT = 3              // Turns without progress before stopping
```

## STATE PER SESSION (`types.ts` `SessionState`)

- Progress: `stagnationCount`, `lastIncompleteCount`, `allTodosCompletedAt`
- Suppression: `isRecovering`, `wasCancelled`, `tokenLimitDetected`, `unrecoverableErrorDetected`, `abortDetectedAt` (cleared after `ABORT_WINDOW_MS`)
- Compaction guard: `recentCompactionAt`, `recentCompactionEpoch`, `acknowledgedCompactionEpoch`
- Retry budget: `consecutiveFailures`, `lastInjectedAt` (cooldown base for exponential backoff)
- Turn-boundary pause: `awaitingPostInjectionProgressCheck`, `continuationResponseObserved`, `continuationBlockReason`, `pendingUserMessageID`
- In-flight: `countdownTimer`/`countdownInterval`, `countdownStartedAt`, `inFlight`

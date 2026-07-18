# src/hooks/todo-continuation-enforcer/ (Boulder Continuation Mechanism)

**Generated:** 2026-07-17 (7d664b96b)

## OVERVIEW

17 source files (~1690 LOC). The "boulder" Continuation Tier hook: forces Sisyphus to keep rolling when incomplete todos remain. Fires on `session.idle`, injects a continuation prompt after a 2s countdown toast.

## HOW IT WORKS

```
session.idle
  → Is main session (not prometheus/compaction/plan)? (DEFAULT_SKIP_AGENTS)
  → No abort detected recently? (ABORT_WINDOW_MS = 3s)
  → Todos still incomplete? (todo.ts)
  → No background tasks running?
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
```

## STATE PER SESSION

```typescript
interface SessionState {
  stagnationCount: number                       // Turns without todo progress
  consecutiveFailures: number                   // Resets after FAILURE_RESET_WINDOW_MS
  lastInjectedAt?: number                       // Cooldown base (exponential backoff)
  abortDetectedAt?: number                      // Cleared after ABORT_WINDOW_MS
  wasCancelled?: boolean                        // Abort/cancel flag
  tokenLimitDetected?: boolean                  // Skip retry on context overflow
  awaitingPostInjectionProgressCheck?: boolean  // Injected, awaiting next turn
  continuationResponseObserved?: boolean       // Assistant replied to injection
  continuationBlockReason?: "directive-response" | "user-interruption"
  pendingUserMessageID?: string                // Deferred user msg pending part classification
  countdownStartedAt?: number
  inFlight?: boolean                           // Injection in progress
  allTodosCompletedAt?: number
}
```

## RELATIONSHIP TO ATLAS

`todoContinuationEnforcer` handles **main Sisyphus sessions** only.
`atlasHook` handles **boulder/ralph/subagent sessions** with a different decision gate.
Both fire on `session.idle` but check session type first.

# src/hooks/todo-continuation-enforcer/ — Boulder Continuation Mechanism

**Generated:** 2026-02-24

## OVERVIEW

14 files (~2061 LOC). The "boulder" — Continuation Tier hook that forces Sisyphus to keep rolling when incomplete todos remain. Fires on `session.idle`, injects continuation prompt after 2s countdown toast.

## HOW IT WORKS

```
session.idle
  → Is main session (not prometheus/compaction)? (DEFAULT_SKIP_AGENTS)
  → No abort detected recently? (ABORT_WINDOW_MS = 3s)
  → Todos still incomplete? (todo.ts)
  → No background tasks running?
  → Cooldown passed? (CONTINUATION_COOLDOWN_MS = 30s)
  → Failure count < max? (MAX_CONSECUTIVE_FAILURES = 5)
  → Start 2s countdown toast → inject CONTINUATION_PROMPT
```

## KEY FILES

| File | Purpose |
|------|---------|
| `handler.ts` | `createTodoContinuationHandler()` — event router, delegates to idle/non-idle handlers |
| `idle-event.ts` | `handleSessionIdle()` — main decision gate for session.idle |
| `non-idle-events.ts` | `handleNonIdleEvent()` — handles session.error (abort detection) |
| `session-state.ts` | `SessionStateStore` — per-session failure/abort/cooldown state |
| `todo.ts` | Check todo completion status via session store |
| `countdown.ts` | 2s countdown toast before injection |
| `abort-detection.ts` | Detect MessageAbortedError / AbortError |
| `continuation-injection.ts` | Build + inject CONTINUATION_PROMPT into session |
| `message-directory.ts` | Temp dir for message injection exchange |
| `constants.ts` | Timing constants, CONTINUATION_PROMPT, skip agents |
| `types.ts` | `SessionState`, handler argument types |

## CONSTANTS

```typescript
DEFAULT_SKIP_AGENTS = ["prometheus", "compaction"]
CONTINUATION_COOLDOWN_MS = 30_000     // 30s between injections
MAX_CONSECUTIVE_FAILURES = 5          // Then 5min pause (exponential backoff)
FAILURE_RESET_WINDOW_MS = 5 * 60_000  // 5min window for failure reset
COUNTDOWN_SECONDS = 2
ABORT_WINDOW_MS = 3000                // Grace after abort signal
```

## STATE PER SESSION

```typescript
interface SessionState {
  failureCount: number       // Consecutive failures
  lastFailureAt?: number     // Timestamp
  abortDetectedAt?: number   // Reset after ABORT_WINDOW_MS
  cooldownUntil?: number     // Next injection allowed after
  countdownTimer?: Timer     // Active countdown reference
}
```

## RELATIONSHIP TO ATLAS

`todoContinuationEnforcer` handles **main Sisyphus sessions** only.
`atlasHook` handles **boulder/ralph/subagent sessions** with a different decision gate.
Both fire on `session.idle` but check session type first.

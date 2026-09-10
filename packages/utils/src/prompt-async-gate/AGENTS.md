# prompt-async-gate — Internal Prompt Dispatch

## OVERVIEW
Reservation, queueing, dedupe, routing, and idle-settling machinery behind `dispatchInternalPrompt()`; score 9, distinct critical-infrastructure domain with 75 exports and heavy cross-package callers.

## WHERE TO LOOK

| Concern | File | Notes |
|---|---|---|
| Queue and retry | `queue.ts` | Per-session queues, in-flight tracking, drain scheduling, backoff. |
| Reservations | `reservations.ts` | Active reservation ownership, expiry handling, transient-retry owners. |
| Dedupe | `semantic-dedupe.ts`, `recent-dispatches.ts` | Canonical dedupe keys and recent-dispatch coalescing. |
| Idle gating | `session-idle-dispatch.ts`, `pending-tool-turn.ts`, `prompt-message-state.ts` | Blocks dispatch while a turn has unanswered or unresolved tools. |
| Routing | `route-resolver.ts` | Live-listener route with in-process fallback on connection failure. |
| Tunables | `timing.ts` | Hold, timeout, and retry defaults plus test-only overrides. |
| Contracts | `types.ts` | Dispatch args, result statuses, and queued-entry shape. |

## CONVENTIONS

- Module-level Maps and Sets hold queue, in-flight, timer, reservation, retry, and dedupe state; `queue.ts` is pinned in package `sideEffects` so it survives tree-shaking.
- Retryable failures back off exponentially with a bounded ceiling; non-durable entries are dropped after repeated retryable failures.
- Coalesce by dedupe key instead of dispatching twice; a queued duplicate returns the existing position.
- Test resets go through the exported `*ForTesting` helpers so state cannot leak between tests.

## ANTI-PATTERNS

- Never dispatch an internal prompt outside this gate; duplicate injections and races are the failure mode it exists to prevent.
- Do not add sleeps or wall-clock waits to callers; use the gate's settle, hold, and drain scheduling.
- Do not mutate queue or reservation maps directly from outside their owning module.

## COMMANDS

```bash
bun test src/prompt-async-gate.test.ts src/prompt-async-gate/*.test.ts
```

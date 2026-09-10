# completion - Terminal Notification Delivery

## OVERVIEW
Builds bounded completion messages and delivers them exactly once while buffering across transient parent-session states.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Delivery state machine | `notifier.ts`, `routing.ts` | Buffering, dedupe, retry, reconciliation, and parent-state routing. |
| Message construction | `notification.ts` | Details, truncation, spill files, and continuation hints. |
| Contracts | `types.ts` | Routing decisions, notifier ports, and persistence inputs. |
| DAG instruction | `dag-verification-directive.ts` | Machine-consumed verification directive included in completion output. |

## CONVENTIONS
- Only externally caused `completed`, `error`, and `lost` statuses notify; parent cancel/interrupt results are synchronous.
- Idle and streaming parents receive notifications unconditionally; compacting, switching, and shutdown buffer them.
- Delivery identity is `(task_id, run_epoch)` and notification bookkeeping is conditional so concurrent record claims survive.
- Responses over `FINAL_RESPONSE_TRANSPORT_LIMIT` spill to the state directory and return a bounded prefix plus a local URI.
- Schedulers and stores are injected, so retry tests do not depend on wall-clock timing.

## ANTI-PATTERNS
- Do not suppress or split a ready idle/streaming notification based on configuration.
- Do not mark a notification delivered before the notifier confirms the parent transport accepted it.
- Do not report a retry exhaustion as a successful delivery.

## HOTSPOTS
- `notifier.ts` (297 lines) holds buffering, dedupe, retry scheduling, reconciliation, and persistence bookkeeping.
- `notification.ts` (161) owns formatting, truncation, and spill-file handling.
- `routing.ts` is small but authoritative; changing its table changes delivery guarantees everywhere.

## QA
```sh
bun test packages/senpi-task/src/completion
```

Parent: [`../AGENTS.md`](../AGENTS.md).

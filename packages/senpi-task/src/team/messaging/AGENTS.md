# messaging - Durable Team Mail Delivery

## OVERVIEW
Implements team message envelopes, lead polling, delivery journaling, session observation, reconciliation, and reservation reclaim.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Envelope/send | `message.ts`, `send.ts` | Normalize payloads and write mailbox messages. |
| Lead polling | `lead-poller.ts`, `lead-poller-types.ts` | Current-lead ownership and injection loop. |
| Delivery ledger | `delivery-journal.ts`, `delivery-events.ts` | In-memory handoff journal and durable event shapes. |
| Session proof | `session-marker-index.ts` | Incremental JSONL marker lookup. |
| Recovery | `session-start-reconcile.ts`, `reclaim.ts` | Reconcile unobserved reservations and stale owners. |

## CONVENTIONS
- Mailbox delivery reserves unread files before injection and commits processed state only after observation.
- The lead poller is owned by the current session; member inboxes are polled by the in-child extension.
- Marker lookup is incremental by byte offset and rescans after truncation/rotation.
- Reconciliation and reclaim are idempotent and retain enough evidence to retry after process failure.

## ANTI-PATTERNS
- Never mark a message processed before the recipient session contains the envelope.
- Do not poll another session's lead mailbox as though it were owned locally.
- Do not replace durable reservation recovery with an in-memory-only success signal.

## HOTSPOTS
- `lead-poller.ts` (168 lines) drives the per-tick delivery loop.
- `session-marker-index.ts` (95) keeps envelope lookups incremental instead of re-parsing whole session files.
- `delivery-journal.ts` bounds per-team entries, so treat it as a handoff ledger, not durable storage.

## QA
```sh
bun test packages/senpi-task/src/team/messaging
```

Parent: [`../AGENTS.md`](../AGENTS.md).

# Gateway sync points with the session gateway lane

Status record of the interface agreements between `packages/omo-gateway` and the session gateway (#9143), tracked in #9190. Each point lists its status (`agreed` / `requested` / `pending`) and, for requests, what the gateway does if the request never ships. Keep this file current: whenever the lane answers or ships a change, update the status here and mirror it in a comment on #9143.

| Point | Status | Summary |
| --- | --- | --- |
| S1 | agreed | One store; the gateway's tables are one additive migration, prefixed to avoid the schema clash |
| S2 | requested | `actor_user_id` on deliveries and `author` on the external origin (additive) |
| S3 | agreed | Bindings are the only chat-thread↔session map |
| S4 | agreed | Terminology: session / chat thread / binding; "handoff" = `thread_handoff` only |
| S5 | requested | Outbox publication marker + in-process SDK import (fallbacks in hand) |
| S6 | agreed | Order: gateway wave 2 starts only after the lane's store, thread tools and CLI merge and release |

## S1 One store — agreed

The gateway's tables are one additive migration on the session-gateway SQLite store, reviewed by that lane before merge; no second database. The store already owns tables named `outbox_cursors` and `session_meta` with different shapes, so the gateway's tables are prefixed `gateway_outbox_cursors` and `gateway_session_meta`; every other gateway table keeps its name unless it clashes with the merged schema.

## S2 One identity — requested (additive)

Delivery rows gain a nullable `actor_user_id`, and the external origin gains `author {platform_user_id, display}`. Principals stay `session:`/`cli:`/`binding:`; `thread_answer` authority consults the gateway's admission layer. No new principal kind, no shape change to existing rows. Requested while the lane's store work is still unbuilt, so the two columns can be absorbed cheaply.

If it does not ship: the gateway derives the acting user from the delivery provenance it already receives plus its own `accounts` rows. Permission decisions keep the same decision table, but per-row attribution is coarser and audit trails name the binding rather than the person.

## S3 One chat-thread↔session map — agreed

Bindings are the only chat-thread↔session map. omomeow's state file and the duty scripts' work-thread maps migrate onto bindings plus the gateway's `work_items` table; no second map is introduced anywhere.

## S4 Words — agreed

"session" = an omo session; "chat thread" = a platform thread; "binding" = the link between them; "handoff" = `thread_handoff` only. All gateway code, docs and UI copy follows this.

## S5 Connector API — requested, not required

Two items, neither a blocker:

1. An outbox publication marker a connector can `fs.watch` (the same inbox-marker pattern deliveries use).
2. The thread CLI's SDK export importable in-process, so a connector does not spawn `omo` per message.

The gateway does NOT depend on named cursors or a refusal field on the ack: it keeps its own `gateway_outbox_cursors` and `outbound_refusals` tables, and the `thread_report` kind enum and the ack shape are not changed.

If it does not ship: the connector `fs.watch`es the session-gateway store's WAL file (it changes on every committed write) instead of a publication marker — no timer polling either way; and connectors keep the current process invocation for reads until the SDK export ships. Both fallbacks are part of the design, not bolt-ons.

## S6 Order — agreed

Gateway wave 2 starts only after the lane's store, thread tools and CLI todos merge to omo `dev` and the senpi release that carries them is out. The gateway bases on the approved SHA the lane posts in its coordination record, then rebases onto the approved CLI head. Wave 1 work (scaffolding, adapter contract, rules store, admission core) does not depend on the lane and proceeds in parallel.

## Also on the record

- The gateway does not build on the thread mailbox path (retired when the senpi release is adopted).
- The gateway consumes the `omo thread ... --json` shapes only from the documented contract in the thread AGENTS.md, never from code.
- Files under `packages/omo-senpi/src/components/thread/**` and `packages/omo-native/bin/lib/thread.js` are owned by the session-gateway lane; the gateway never edits them and routes change requests through that lane.

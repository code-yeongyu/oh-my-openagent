# mass-ulw viewer protocol

The wire contract for external viewers of DAG orchestration runs. Everything below is grounded in
the shipped code:

- `packages/senpi-task/src/dag/types.ts` (event union, envelope, activity type)
- `packages/omo-senpi/src/components/task/dag-rpc-bridge.ts` (push channels)
- `packages/omo-senpi/src/components/task/dag-rpc-handlers.ts` (request methods)

A viewer can be implemented from this document alone. Schema version is `1` on every payload that
carries one; a consumer must reject payloads with an unknown `schemaVersion`.

## Transport and reachability

All push traffic uses senpi extension events (`pi.rpc.emit`), and all pull traffic uses senpi RPC
request handlers (`pi.rpc.handle`).

- Classic RPC clients only receive extension events when they advertise the capability. Set
  `SENPI_RPC_CLIENT_CAPABILITIES=extension_events` before connecting. Without it the four push
  channels are silently unreachable, while the request methods still work.
- App-server delivery is thread-scoped and ungated. A client attached to the session's thread
  receives the events with no capability flag.

## Push channels

Four extension-event channels exist. Only one of them is sequenced.

| Channel | Sequenced | Persisted | Purpose |
| --- | --- | --- | --- |
| `omo.dag.event` | yes (`seq`) | yes (WAL) | The journaled run ledger. The only channel in the seq ledger. |
| `omo.dag.heartbeat` | no | no | Liveness beacon for nonterminal runs. |
| `omo.dag.activity` | no | no | Live per-node telemetry. |
| `omo.dag.updated` | no | no | Wholesale run-list snapshot for stateless consumers. |

### `omo.dag.event`

Every payload is the FLAT intersection of the envelope and one of the 17 journaled payload types.
`type`, `seq`, and the payload fields are siblings on one object, not nested.

Envelope fields, present on every event:

```jsonc
{
  "schemaVersion": 1,
  "runId": "...",     // string, run identity
  "seq": 42,           // WAL-assigned, strictly increasing per run
  "at": "...",        // ISO 8601 timestamp
  "lane": "boundary"  // "boundary" or "activity"
}
```

The `lane` distinction: `boundary` marks state transitions and run lifecycle, journaled with a WAL
seq. `activity` is the live-telemetry lane name used by stream classification; the actual
`DagActivityEvent` payloads are unsequenced and travel on `omo.dag.activity`, never here.

The 17 journaled payload types (`DAG_RUN_EVENT_TYPES`), with their fields beyond the envelope:

| `type` | Payload fields |
| --- | --- |
| `dag.run.created` | `runKey`, `name`, `definitionFingerprint`, `nodeCount`, `edgeCount` |
| `dag.run.started` | `generation` |
| `dag.run.paused` | `reason?` |
| `dag.run.resumed` | `generation` |
| `dag.run.completed` | `counts` (node-state counters) |
| `dag.run.failed` | `error` (`{code, message, nodeId?, at}`), `counts` |
| `dag.run.cancelled` | `reason?`, `counts` |
| `dag.wave.started` | `waveIndex`, `nodeIds` |
| `dag.wave.completed` | `waveIndex`, `nodeIds` |
| `dag.node.transitioned` | `nodeId`, `from`, `to`, `reason` (`{kind}` object, `task_queued` adds `queuePosition`) |
| `dag.node.task-attached` | `nodeId`, `taskId`, `attempt` |
| `dag.node.reused` | `nodeId`, `taskId`, `sourceRunId` |
| `dag.node.retried` | `nodeId`, `priorTaskId?`, `execAttempt`, `promptChanged` |
| `dag.node.steered` | `nodeId`, `taskId`, `delivery` (`"steer"` \| `"revive"`) |
| `dag.definition.amended` | `previousFingerprint`, `fingerprint`, `changedNodeIds`, `addedNodeIds`, `invalidatedNodeIds` |
| `dag.diagnostic.added` | `diagnostic` (`route_fallback` \| `node_flag` \| `missing_skill` \| `run_flag` \| `journal_corrupt`). `missing_skill` includes `nodeId` + `skill`; `journal_corrupt` includes `path` and optional `runId` |
| `dag.stream.overflow` | `droppedCount`, `recoverAfterSeq` (see the recovery rules below) |

Node states: `pending`, `blocked`, `scheduled`, `running`, `completed`, `failed`, `cancelled`,
`skipped`. Run statuses: `pending`, `running`, `paused`, `completed`, `failed`, `cancelled`.
`counts` carries `total` plus one counter per node state.

### `omo.dag.heartbeat`

```jsonc
{
  "schemaVersion": 1,
  "at": "...",
  "runs": [ { "runId": "...", "headSeq": 42 } ]
}
```

Emitted every 15s (default) while at least one owned run is nonterminal. Terminal runs
(`completed`, `failed`, `cancelled`) never earn a heartbeat. `headSeq` is the highest seq the
bridge has forwarded for that run, so a viewer can detect that it fell behind without waiting for
the next event.

### `omo.dag.activity`

```jsonc
{
  "schemaVersion": 1,
  "runId": "...",
  "nodeId": "...",
  "taskId": "...",
  "at": "...",
  "activity": "...",
  "currentTool": "...",        // optional
  "lastAssistantLine": "...",  // optional
  "turns": 3,
  "toolCalls": 7                // optional
}
```

Coalesced latest-wins per `(runId, nodeId)` over a 150ms window: a chatty node collapses to one
payload per window. Treat every payload as a full replacement of that node's live status.

### `omo.dag.updated`

Wholesale snapshot of the whole owned run set, debounced 50ms and fingerprint-deduped. Field names
are snake_case (the same wire convention as `omo.task.updated`); optional fields are absent, never
`null`.

```jsonc
{
  "parent_session_id": "...",
  "runs": [
    {
      "run_id": "...", "run_key": "...", "name": "...", "status": "...",
      "created_at": "...", "updated_at": "...",
      "counts": { "total": 4, "completed": 2 },
      "nodes": [
        {
          "id": "...", "label": "...", "prompt": "...", "depends_on": ["..."],
          "state": "...", "attempt": 1, "created_at": "...",
          "task_id": "...", "started_at": "...", "completed_at": "...",
          "last_error": { "code": "...", "message": "..." }
        }
      ],
      "edges": [ { "from": "...", "to": "..." } ],
      "waves": [ { "index": 0, "node_ids": ["..."] } ],
      "amend_count": 2   // present only once the run has accepted an amendment
    }
  ],
  "truncated_runs": 3   // present only when runs were cut at the 256-run cap
}
```

Compatibility: the three node-control event types and the snapshot fields below are strictly
ADDITIVE. `schemaVersion` stays `1` per this document's own versioning policy — every new field is
optional and absent (never `null`) when inapplicable, no existing field was renamed, reordered, or
removed, and consumers that ignore unknown event types and unknown fields keep working untouched.

Per-node `attempt` counts task attachments, so it rises on a retry and also on a pure reattach after
a restart. A viewer that wants "how many times was this node deliberately re-run" should read the
`dag.node.retried` events, not `attempt`. `last_error` carries the failure of the LAST settled
attempt and is absent once a retry puts the node back in flight, so a node showing both
`state: "running"` and no `last_error` is a retry in progress. Run-level `amend_count` is the number
of accepted amendments and is absent on runs that were never amended.

## Emission rules

- Journaled events reach `omo.dag.event` only AFTER the WAL append and the checkpoint replace both
  succeed. There is no pre-durability emission path: an event you receive is already on disk and
  will replay from `omo.dag.history`.
- The bridge delivers each seq at most once per attach. A journal reopen may redeliver a seq; the
  bridge drops anything at or below the last forwarded seq for that run.
- Heartbeats are never persisted and do not advance `seq`. They carry no payload state beyond
  `headSeq` observations.
- Activity is unsequenced and never enters the seq ledger. It is never journaled and must never be
  treated as replayable.
- `omo.dag.updated` is derived state. It can lag or skip intermediate states (debounce plus
  dedupe); do not use it for event-level bookkeeping.

## Request methods

All four methods return the same envelope:

```jsonc
{ "ok": true,  "value": { /* method-specific */ } }
{ "ok": false, "error": { "code": "...", "message": "..." } }
```

Error codes (`DAG_RPC_ERROR_CODES`): `invalid_arguments`, `run_not_found`, `run_not_owned`,
`history_unavailable`. Nothing crosses the boundary as a throw; unknown failures degrade to
`history_unavailable`. When no session is active, run-scoped methods answer `run_not_owned` and
`omo.dag.list` answers with an empty run list.

### `omo.dag.list`

Params: `{ statuses?: string[], limit?: number }`. `statuses` values must come from the run-status
vocabulary. `limit` defaults to 100, capped at 256.

Value: `{ runs: [{ runId, runKey, name, parentSessionId, status, createdAt, updatedAt, counts }], limit }`.
`counts` is the full node-state counter object; `limit` is the caller limit after clamp (default
100, max 256). The status filter is applied after the
engine's maximum window, so a filtered query never loses runs the window already held.

### `omo.dag.snapshot`

Params: `{ runId: string }`.

Value: the full camelCase `DagRunSnapshot` (not the snake_case `omo.dag.updated` projection). It
always includes `lastSeq` (WAL head) plus run identity, `status`, `generation`, the graph
(`nodes`/`edges`/`waves`/`criticalPath`/`bottlenecks`), `diagnostics`, `counts`, and
`amendHistory` when the run was amended. Node `prompt` is the submitted prompt, not the
skill-prepended `effectivePrompt`.

### `omo.dag.history`

Params: `{ runId, sinceSeq?, limit?, lane?, types?, throughSeq? }`.

- `sinceSeq` is EXCLUSIVE (events with `seq > sinceSeq`), default 0.
- `limit` defaults to 256, capped at 1000.
- `lane` must be `activity` or `boundary` when present; `types` filters by event `type`.
- `throughSeq` bounds the page inclusively, which is what freezes a paging window.

Value: `{ events, nextSinceSeq, headSeq, hasMore }`. Page with `sinceSeq = nextSinceSeq` until
`hasMore` is false.

### `omo.dag.subscribe`

Params: same shape as `omo.dag.history`. This is a stateless catch-up handshake; no server-side
subscriber is registered. The snapshot is read first, so `highWaterSeq` describes the ledger before
the first page is read, and the page is bounded by that mark.

Value:

```jsonc
{
  "schemaVersion": 1,
  "eventName": "omo.dag.event",
  "snapshot": { "runId": "...", "status": "...", "lastSeq": 42 },
  "highWaterSeq": 42,
  "page": { "events": [], "nextSinceSeq": 42, "headSeq": 42, "hasMore": false }
}
```

## Gap-free catch-up algorithm

The seq ledger is scoped to `omo.dag.event` only. Dedupe by `(runId, seq)`.

1. Register your `omo.dag.event` listener FIRST, before any request. Buffer everything it receives.
2. Call `omo.dag.subscribe` for the run. Record `highWaterSeq` from the handshake.
3. Apply the handshake `page` to your model.
4. While `page.hasMore`, call `omo.dag.history` with `sinceSeq = page.nextSinceSeq` and
   `throughSeq: highWaterSeq`. The bound freezes the window: paging never races past events that
   arrived live during the loop.
5. Drain the live buffer, dropping every event with `seq <= highWaterSeq` or any `(runId, seq)`
   already applied. Apply the rest in seq order.
6. Steady state: apply live events, tracking the last applied seq per run. On a non-contiguous seq
   (received seq > last applied + 1), refetch the gap via `omo.dag.history` with
   `sinceSeq = lastApplied` and `throughSeq = received seq`, then continue.

## Overflow recovery

`dag.stream.overflow` reports how much live subscriber buffering was lost:

- `droppedCount` is the number of queued events evicted from that subscriber's ring.
- `recoverAfterSeq` is the last seq delivered to that subscriber before the loss. It is an
  exclusive-since recovery cursor, not the first dropped seq.

The overflow notification is itself appended through the normal locked WAL and checkpoint pipeline.
It receives a fresh seq greater than the current WAL tail. No journal seq is ever reused, including
when reporting overflow; the overflow event's envelope `seq` is therefore not a dropped event's seq.

When a viewer receives an overflow event, it must pause normal application and call
`omo.dag.history` with `sinceSeq = recoverAfterSeq` and `throughSeq = overflow.seq`. Apply that
bounded page and every continuation page in seq order, deduping by `(runId, seq)`. This recovers all
missed durable events and the overflow event itself. Then resume buffered live delivery, discarding
any event whose seq was already applied. Do not subtract one from `recoverAfterSeq`, and do not infer
a recovery cursor from `droppedCount` or the overflow event's own seq.

## omo-desktop-app integration

Deferred follow-up. The wiring described here is NOT shipped; this section only maps the contract
onto the app's existing pattern so the follow-up is mechanical.

omo-desktop-app already consumes `omo.task.updated`: it registers one `extension_event` name and
runs a wholesale-replace reducer that swaps the stored task list on every payload. This protocol
was shaped so `omo.dag.updated` slots into that exact pattern:

- One NEW `extension_event` name to register: `omo.dag.updated`. No new transport, no new
  capability; app-server delivery is thread-scoped and already reaches the app.
- One wholesale-replace reducer: on each payload, replace the run list for `parent_session_id`
  with `runs`. No per-event state, no seq tracking, no merge logic. Surface `truncated_runs` when
  present.
- The payload is already snake_case for the same reason `omo.task.updated` is: the app's decoders
  expect that convention.

An app view that later wants event-level fidelity (live edge animation, per-transition history)
graduates to the `omo.dag.event` ledger and the catch-up algorithm above. Until then the
snapshot channel is the whole integration.

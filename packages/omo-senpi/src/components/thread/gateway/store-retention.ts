/**
 * Retention for the tables nothing else prunes. Runs inside a write transaction the store already
 * takes (an enqueue, a relay mutation, an outbox read), never at open, so opening a current store
 * still takes no write lock. Each statement deletes at most `RETENTION_SWEEP_BATCH` rows; a sweep
 * that hit a batch bound makes the next sweep due at once, any other sweep waits
 * `RETENTION_SWEEP_INTERVAL_MS`. Nothing an open claim, a live receipt or an active binding still
 * reads is deleted.
 */
import { OUTBOX_RETENTION_MS, rfc3339 } from "./bindings"
import { DELIVERY_RETENTION_MS, PAIR_BUCKET_BURST, PAIR_BUCKET_REFILL_MS, RETENTION_SWEEP_BATCH, RETENTION_SWEEP_INTERVAL_MS } from "./constants"
import { OPEN_STATES, type StoreContext, write } from "./store-ops"

const nextSweepDue = new WeakMap<StoreContext, number>()

export type RetentionSweep = {
  readonly receipts: number
  readonly deliveries: number
  readonly causal_edges: number
  readonly causal_roots: number
  readonly rate_buckets: number
  readonly bindings: number
  readonly outbox_cursors: number
  readonly session_meta: number
}

/** Clears the expired receipt under one key, so a call can reuse a key whose receipt outlived its retention. */
export function deleteExpiredReceipt(ctx: StoreContext, key: { readonly principal: string; readonly operation: string; readonly idempotency_key: string }, now: number): void {
  write(ctx, "DELETE FROM receipts WHERE principal = ? AND operation = ? AND idempotency_key = ? AND expires_at <= ?", [key.principal, key.operation, key.idempotency_key, now])
}

/** Runs one bounded sweep when one is due; call it inside an open write transaction. */
export function sweepRetentionIfDue(ctx: StoreContext, now: number): RetentionSweep | null {
  if (now < (nextSweepDue.get(ctx) ?? Number.NEGATIVE_INFINITY)) return null
  const swept = sweepRetention(ctx, now)
  const full = Object.values(swept).some((count) => count >= RETENTION_SWEEP_BATCH)
  nextSweepDue.set(ctx, full ? now : now + RETENTION_SWEEP_INTERVAL_MS)
  return swept
}

export function sweepRetention(ctx: StoreContext, now: number): RetentionSweep {
  const batch = RETENTION_SWEEP_BATCH
  // A receipt check clears only an expired receipt under its own key; the backlog goes here, a batch at a time.
  const receipts = write(ctx, "DELETE FROM receipts WHERE rowid IN (SELECT rowid FROM receipts WHERE expires_at <= ? LIMIT ?)", [now, batch])
  // A terminal delivery a live receipt points at stays: the receipt's replay reads it.
  const deliveries = write(
    ctx,
    "DELETE FROM deliveries WHERE delivery_id IN (SELECT d.delivery_id FROM deliveries d WHERE d.state IN ('applied', 'refused') AND d.updated_at <= ? AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.delivery_id = d.delivery_id) LIMIT ?)",
    [now - DELIVERY_RETENTION_MS, batch],
  )
  // An expired root refuses every continuation (`root_expired`) whether or not its row exists, so
  // its edges no longer guard a cycle; the root row goes once its edges are gone.
  const causalEdges = write(
    ctx,
    "DELETE FROM causal_edges WHERE rowid IN (SELECT e.rowid FROM causal_edges e JOIN causal_roots r ON r.root_id = e.root_id WHERE r.expires_at <= ? LIMIT ?)",
    [now, batch],
  )
  const causalRoots = write(
    ctx,
    "DELETE FROM causal_roots WHERE root_id IN (SELECT r.root_id FROM causal_roots r WHERE r.expires_at <= ? AND NOT EXISTS (SELECT 1 FROM causal_edges e WHERE e.root_id = r.root_id) LIMIT ?)",
    [now, batch],
  )
  // A bucket idle for a full refill holds the full burst, exactly what a missing bucket starts with.
  const rateBuckets = write(
    ctx,
    "DELETE FROM rate_buckets WHERE rowid IN (SELECT rowid FROM rate_buckets WHERE updated_at <= ? LIMIT ?)",
    [now - PAIR_BUCKET_BURST * PAIR_BUCKET_REFILL_MS, batch],
  )
  const bindings = write(
    ctx,
    `DELETE FROM bindings WHERE binding_id IN (SELECT b.binding_id FROM bindings b WHERE b.status != 'active' AND b.updated_at <= ?
      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.binding_id = b.binding_id)
      AND NOT EXISTS (SELECT 1 FROM completion_arms a WHERE a.binding_id = b.binding_id)
      AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.binding_id = b.binding_id AND d.state IN ${OPEN_STATES}) LIMIT ?)`,
    [rfc3339(now - OUTBOX_RETENTION_MS), batch],
  )
  const outboxCursors = write(
    ctx,
    "DELETE FROM outbox_cursors WHERE binding_id IN (SELECT c.binding_id FROM outbox_cursors c WHERE NOT EXISTS (SELECT 1 FROM bindings b WHERE b.binding_id = c.binding_id) LIMIT ?)",
    [batch],
  )
  // A session's meta row (sequence counter, incarnation) is only read for its deliveries and the
  // reply tokens of its bindings; once nothing references the session it is rebuilt on demand
  // (`allocateSeq` from MAX(seq), the incarnation at the session's next start).
  const sessionMeta = write(
    ctx,
    `DELETE FROM session_meta WHERE durable_id IN (SELECT m.durable_id FROM session_meta m WHERE
      NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.target_durable_id = m.durable_id)
      AND NOT EXISTS (SELECT 1 FROM bindings b WHERE b.session_durable_id = m.durable_id)
      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.session_durable_id = m.durable_id)
      AND NOT EXISTS (SELECT 1 FROM completion_arms a WHERE a.session_durable_id = m.durable_id) LIMIT ?)`,
    [batch],
  )
  return { receipts, deliveries, causal_edges: causalEdges, causal_roots: causalRoots, rate_buckets: rateBuckets, bindings, outbox_cursors: outboxCursors, session_meta: sessionMeta }
}

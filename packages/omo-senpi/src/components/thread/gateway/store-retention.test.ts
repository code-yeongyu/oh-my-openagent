import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"

import { rfc3339 } from "./bindings"
import { DELIVERY_RETENTION_MS, RETENTION_SWEEP_BATCH } from "./constants"
import { gatewayDatabasePath } from "./paths"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

const DAY = 24 * 60 * 60 * 1000

let harness: GatewayHarness | undefined

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function insertDelivery(db: Database, id: string, state: string, updatedAt: number, extra: { readonly target?: string; readonly seq: number; readonly root?: string; readonly binding?: string }): void {
  db.run(
    "INSERT INTO deliveries (delivery_id, target_durable_id, seq, sender, envelope, body, bytes, mode_requested, state, root_id, hop, created_at, updated_at, expires_at, binding_id) VALUES (?, ?, ?, 'session:A', '{}', 'body', 4, 'auto', ?, ?, 1, ?, ?, ?, ?)",
    [id, extra.target ?? "B", extra.seq, state, extra.root ?? "root-x", updatedAt, updatedAt, updatedAt + DAY, extra.binding ?? null],
  )
}

function insertBinding(db: Database, id: string, status: string, updatedAt: number, session = "B", chat = id): void {
  db.run(
    "INSERT INTO bindings (binding_id, revision, status, platform, account_id, chat_id, thread_id, session_realm_id, session_durable_id, direction_inbound, direction_outbound, inbound_mode, outbound_events, policy_id, created_at, updated_at, lease_started_at) VALUES (?, 1, ?, 'custom', 'bot', ?, '@chat', 'realm-x', ?, 1, 1, 'auto', '[\"report\"]', 'default', ?, ?, ?)",
    [id, status, chat, session, rfc3339(updatedAt), rfc3339(updatedAt), rfc3339(updatedAt)],
  )
}

function ids(db: Database, table: string, column: string): string[] {
  return db.query(`SELECT ${column} AS id FROM ${table} ORDER BY ${column}`).all().map((row) => String((row as { id: unknown }).id))
}

async function bindSomething(h: GatewayHarness, chat: string) {
  const bound = await h.store().bind({ now: h.clock.now, receipt: null, binding: { platform: "custom", account_id: "bot", chat_id: chat, thread_id: "@chat", root_message_id: null, progress_message_id: null, session_durable_id: "C", direction: { inbound: true, outbound: true }, inbound_mode: "auto", outbound_events: ["report"], policy_id: "default", ttl_seconds: null } })
  if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
}

describe("gateway store retention", () => {
  test("#given rows past their retention next to rows something still reads #when a write transaction sweeps #then only the unreferenced old rows are gone", async () => {
    const h = (harness = createGatewayHarness())
    const t0 = h.clock.now
    expect(await h.store().journalMode()).toBe("wal")
    const db = new Database(gatewayDatabasePath(h.agentDir))
    try {
      db.run("PRAGMA busy_timeout = 5000")
      db.run("INSERT INTO causal_roots (root_id, origin_principal, created_at, expires_at) VALUES ('root-old', 'session:A', ?, ?), ('root-live', 'session:A', ?, ?)", [t0, t0 + 7 * DAY, t0, t0 + 40 * DAY])
      db.run("INSERT INTO causal_edges (root_id, from_durable_id, to_durable_id, delivery_id, created_at) VALUES ('root-old', 'A', 'B', 'd-applied', ?), ('root-live', 'A', 'B', 'd-recent', ?)", [t0, t0])
      insertDelivery(db, "d-applied", "applied", t0, { seq: 1, root: "root-old" })
      insertDelivery(db, "d-refused", "refused", t0, { seq: 2 })
      insertDelivery(db, "d-queued", "queued", t0, { seq: 3 })
      insertDelivery(db, "d-admitted", "admitted", t0, { seq: 4 })
      insertDelivery(db, "d-receipt", "applied", t0, { seq: 5 })
      insertDelivery(db, "d-recent", "applied", t0 + 30 * DAY, { seq: 6, root: "root-live" })
      insertDelivery(db, "d-open-binding", "queued", t0, { seq: 7, binding: "bnd-in-flight" })
      db.run("INSERT INTO receipts (principal, operation, idempotency_key, args_hash, status, delivery_id, owner_instance, created_at, updated_at, expires_at) VALUES ('session:A', 'deliver', 'k', 'h', 'completed', 'd-receipt', 'i', ?, ?, ?)", [t0, t0, t0 + 60 * DAY])
      db.run("INSERT INTO rate_buckets (sender, target_durable_id, tokens, updated_at) VALUES ('session:A', 'B', 0, ?), ('session:C', 'B', 0, ?)", [t0, t0 + 31 * DAY - 1_000])
      insertBinding(db, "bnd-closed", "detached", t0)
      insertBinding(db, "bnd-active", "active", t0, "B", "chat-active")
      insertBinding(db, "bnd-acked-row", "detached", t0)
      insertBinding(db, "bnd-in-flight", "expired", t0)
      insertBinding(db, "bnd-recent", "detached", t0 + 20 * DAY)
      db.run("INSERT INTO outbox (binding_id, revision, event_kind, payload, state, created_at, acked_at) VALUES ('bnd-acked-row', 1, 'report', '{}', 'acked', ?, ?)", [t0, t0 + 30 * DAY])
      db.run("INSERT INTO outbox_cursors (binding_id, acked_cursor, updated_at) VALUES ('bnd-closed', 1, ?), ('bnd-active', 0, ?)", [t0, t0])
      db.run("INSERT INTO session_meta (durable_id, next_seq) VALUES ('B', 8), ('S-gone', 3)")
      h.clock.now = t0 + 31 * DAY
      await bindSomething(h, "trigger")
      expect({
        deliveries: ids(db, "deliveries", "delivery_id"),
        causal_roots: ids(db, "causal_roots", "root_id"),
        causal_edges: ids(db, "causal_edges", "root_id"),
        rate_buckets: ids(db, "rate_buckets", "sender"),
        bindings: ids(db, "bindings", "binding_id").filter((id) => !/^bnd-[0-9a-f]{8}-/.test(id)),
        outbox_cursors: ids(db, "outbox_cursors", "binding_id"),
        session_meta: ids(db, "session_meta", "durable_id"),
      }).toEqual({
        deliveries: ["d-admitted", "d-open-binding", "d-queued", "d-receipt", "d-recent"],
        causal_roots: ["root-live"],
        causal_edges: ["root-live"],
        rate_buckets: ["session:C"],
        bindings: ["bnd-acked-row", "bnd-active", "bnd-in-flight", "bnd-recent"],
        outbox_cursors: ["bnd-active"],
        session_meta: ["B"],
      })
    } finally {
      db.close()
    }
  })

  test("#given more expired deliveries than one sweep may delete #when two write transactions run #then the first deletes one batch and the second, due at once, deletes the rest", async () => {
    const h = (harness = createGatewayHarness())
    const t0 = h.clock.now
    expect(await h.store().journalMode()).toBe("wal")
    const db = new Database(gatewayDatabasePath(h.agentDir))
    try {
      db.run("PRAGMA busy_timeout = 5000")
      const total = RETENTION_SWEEP_BATCH + 44
      db.transaction(() => { for (let seq = 1; seq <= total; seq++) insertDelivery(db, `d-${seq}`, "refused", t0, { seq }) })()
      h.clock.now = t0 + DELIVERY_RETENTION_MS + 1
      await bindSomething(h, "first")
      expect(ids(db, "deliveries", "delivery_id")).toHaveLength(total - RETENTION_SWEEP_BATCH)
      await bindSomething(h, "second")
      expect(ids(db, "deliveries", "delivery_id")).toHaveLength(0)
    } finally {
      db.close()
    }
  })
})

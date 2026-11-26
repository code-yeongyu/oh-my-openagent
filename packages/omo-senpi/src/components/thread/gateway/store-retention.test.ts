import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"

import { DELIVERY_RETENTION_MS, RETENTION_SWEEP_BATCH, RETENTION_SWEEP_INTERVAL_MS } from "./constants"
import { gatewayDatabasePath } from "./paths"
import type { GatewayStore } from "./store"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

const DAY = 24 * 60 * 60 * 1000

let harness: GatewayHarness | undefined

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function insertDelivery(
  db: Database,
  id: string,
  state: string,
  updatedAt: number,
  extra: { readonly target?: string; readonly seq: number; readonly root?: string; readonly expiresAt?: number },
): void {
  db.run(
    'INSERT INTO deliveries (delivery_id, target_durable_id, seq, sender, envelope, body, bytes, mode_requested, state, root_id, hop, created_at, updated_at, expires_at) VALUES (?, ?, ?, \'session:A\', \'{"provenance":{"workspace":"Example","project":"project"}}\', \'body\', 4, \'auto\', ?, ?, 1, ?, ?, ?)',
    [
      id,
      extra.target ?? "B",
      extra.seq,
      state,
      extra.root ?? "root-x",
      updatedAt,
      updatedAt,
      extra.expiresAt ?? updatedAt + DAY,
    ],
  )
}

function ids(db: Database, table: string, column: string): string[] {
  return db
    .query(`SELECT ${column} AS id FROM ${table} ORDER BY ${column}`)
    .all()
    .map((row) => String((row as { id: unknown }).id))
}

/** A tool receipt admission: one write transaction, which runs the retention sweep when one is due. */
async function toolCall(store: GatewayStore, now: number, key: string) {
  const admitted = await store.toolReceiptBegin({
    principal: "session:A",
    operation: "thread_rename",
    idempotency_key: `call-${key}`,
    args_hash: "h",
    now,
  })
  if (admitted.kind !== "accepted") throw new Error(JSON.stringify(admitted))
}

describe("gateway store retention", () => {
  test("#given rows past their retention next to rows something still reads #when a write transaction sweeps #then only the unreferenced old rows are gone", async () => {
    const h = (harness = createGatewayHarness())
    const t0 = h.clock.now
    const store = h.store()
    expect(await store.journalMode()).toBe("wal")
    const db = new Database(gatewayDatabasePath(h.agentDir))
    try {
      db.run("PRAGMA busy_timeout = 5000")
      db.run(
        "INSERT INTO causal_roots (root_id, origin_principal, created_at, expires_at) VALUES ('root-old', 'session:A', ?, ?), ('root-live', 'session:A', ?, ?)",
        [t0, t0 + 7 * DAY, t0, t0 + 40 * DAY],
      )
      db.run(
        "INSERT INTO causal_edges (root_id, from_durable_id, to_durable_id, delivery_id, created_at) VALUES ('root-old', 'A', 'B', 'd-applied', ?), ('root-live', 'A', 'B', 'd-recent', ?)",
        [t0, t0],
      )
      insertDelivery(db, "d-applied", "applied", t0, { seq: 1, root: "root-old" })
      insertDelivery(db, "d-refused", "refused", t0, { seq: 2 })
      insertDelivery(db, "d-queued", "queued", t0, { seq: 3, expiresAt: t0 + 40 * DAY })
      insertDelivery(db, "d-admitted", "admitted", t0, { seq: 4, expiresAt: t0 + 40 * DAY })
      insertDelivery(db, "d-receipt", "applied", t0, { seq: 5 })
      insertDelivery(db, "d-recent", "applied", t0 + 30 * DAY, { seq: 6, root: "root-live" })
      db.run(
        "INSERT INTO receipts (principal, operation, idempotency_key, args_hash, status, delivery_id, owner_instance, created_at, updated_at, expires_at) VALUES ('session:A', 'deliver', 'k', 'h', 'completed', 'd-receipt', 'i', ?, ?, ?)",
        [t0, t0, t0 + 60 * DAY],
      )
      db.run(
        "INSERT INTO rate_buckets (sender, target_durable_id, tokens, updated_at) VALUES ('session:A', 'B', 0, ?), ('session:C', 'B', 0, ?)",
        [t0, t0 + 31 * DAY - 1_000],
      )
      db.run("INSERT INTO session_meta (durable_id, next_seq) VALUES ('B', 8), ('S-gone', 3)")
      h.clock.now = t0 + 31 * DAY
      await toolCall(store, h.clock.now, "trigger")
      expect({
        deliveries: ids(db, "deliveries", "delivery_id"),
        causal_roots: ids(db, "causal_roots", "root_id"),
        causal_edges: ids(db, "causal_edges", "root_id"),
        rate_buckets: ids(db, "rate_buckets", "sender"),
        session_meta: ids(db, "session_meta", "durable_id"),
      }).toEqual({
        deliveries: ["d-admitted", "d-queued", "d-receipt", "d-recent"],
        causal_roots: ["root-live"],
        causal_edges: ["root-live"],
        rate_buckets: ["session:C"],
        session_meta: ["B"],
      })
    } finally {
      db.close()
    }
  })

  // One store throughout: the next sweep's due time is kept per open store, so a second store would
  // sweep regardless of what the first sweep scheduled.
  test("#given more expired deliveries than one sweep may delete #when two write transactions run on one store #then the first deletes one batch and the second, due at once, deletes the rest", async () => {
    const h = (harness = createGatewayHarness())
    const t0 = h.clock.now
    const store = h.store()
    expect(await store.journalMode()).toBe("wal")
    const db = new Database(gatewayDatabasePath(h.agentDir))
    try {
      db.run("PRAGMA busy_timeout = 5000")
      const total = RETENTION_SWEEP_BATCH + 44
      db.transaction(() => {
        for (let seq = 1; seq <= total; seq++) insertDelivery(db, `d-${seq}`, "refused", t0, { seq })
      })()
      h.clock.now = t0 + DELIVERY_RETENTION_MS + 1
      await toolCall(store, h.clock.now, "first")
      expect(ids(db, "deliveries", "delivery_id")).toHaveLength(total - RETENTION_SWEEP_BATCH)
      await toolCall(store, h.clock.now, "second")
      expect(ids(db, "deliveries", "delivery_id")).toHaveLength(0)
    } finally {
      db.close()
    }
  })

  test("#given more expired receipts than one sweep may delete #when two write transactions run on one store #then the first deletes one batch and the second, due at once, deletes the rest", async () => {
    const h = (harness = createGatewayHarness())
    const t0 = h.clock.now
    const store = h.store()
    expect(await store.journalMode()).toBe("wal")
    const db = new Database(gatewayDatabasePath(h.agentDir))
    try {
      db.run("PRAGMA busy_timeout = 5000")
      const total = RETENTION_SWEEP_BATCH + 44
      db.transaction(() => {
        for (let index = 1; index <= total; index++) {
          db.run(
            "INSERT INTO receipts (principal, operation, idempotency_key, args_hash, status, delivery_id, owner_instance, created_at, updated_at, expires_at) VALUES ('session:A', 'thread_rename', ?, 'h', 'completed', NULL, 'i', ?, ?, ?)",
            [`k-${index}`, t0, t0, t0 + DAY],
          )
        }
      })()
      h.clock.now = t0 + 2 * DAY
      // The receipt check of a keyed call clears only its own key's expired receipt.
      await toolCall(store, h.clock.now, "first")
      expect(ids(db, "receipts", "idempotency_key").filter((key) => key.startsWith("k-"))).toHaveLength(
        total - RETENTION_SWEEP_BATCH,
      )
      await toolCall(store, h.clock.now, "second")
      expect(ids(db, "receipts", "idempotency_key")).toEqual(["call-first", "call-second"])
    } finally {
      db.close()
    }
  })

  test("#given more expired receipts than one sweep may delete #when only peer tool calls write (no enqueue) #then each call deletes at most one batch, the backlog drains over successive calls, and a later backlog waits for the sweep interval", async () => {
    const h = (harness = createGatewayHarness())
    const t0 = h.clock.now
    const store = h.store()
    expect(await store.journalMode()).toBe("wal")
    const db = new Database(gatewayDatabasePath(h.agentDir))
    const seed = (prefix: string, count: number, expiresAt: number) =>
      db.transaction(() => {
        for (let index = 1; index <= count; index++) {
          db.run(
            "INSERT INTO receipts (principal, operation, idempotency_key, args_hash, status, delivery_id, owner_instance, created_at, updated_at, expires_at) VALUES ('session:A', 'thread_rename', ?, 'h', 'completed', NULL, 'i', ?, ?, ?)",
            [`${prefix}-${index}`, t0, t0, expiresAt],
          )
        }
      })()
    const expired = (prefix: string) =>
      ids(db, "receipts", "idempotency_key").filter((key) => key.startsWith(`${prefix}-`)).length
    const toolCall = async (key: string) => {
      const scope = { principal: "session:caller", operation: "thread_list", idempotency_key: key }
      expect(await store.toolReceiptBegin({ ...scope, now: h.clock.now, args_hash: "h" })).toEqual({ kind: "accepted" })
      expect(await store.toolReceiptSettle({ ...scope, now: h.clock.now, result: { kind: "ok" } })).toBe(true)
    }
    try {
      db.run("PRAGMA busy_timeout = 5000")
      const total = RETENTION_SWEEP_BATCH + 44
      seed("old", total, t0 + DAY)
      h.clock.now = t0 + 2 * DAY
      await toolCall("call-1")
      expect(expired("old")).toBe(total - RETENTION_SWEEP_BATCH)
      await toolCall("call-2")
      expect(expired("old")).toBe(0)

      seed("later", 1, t0 + DAY)
      h.clock.now += RETENTION_SWEEP_INTERVAL_MS - 1
      await toolCall("call-3")
      expect(expired("later")).toBe(1)
      h.clock.now += 1
      await toolCall("call-4")
      expect({ later: expired("later"), calls: expired("call") }).toEqual({ later: 0, calls: 4 })
    } finally {
      db.close()
    }
  })

  type KeyedCall = {
    readonly principal: string
    readonly operation: string
    readonly call: (h: GatewayHarness, key: string) => Promise<void>
  }
  const keyedCalls: readonly (readonly [string, KeyedCall])[] = [
    [
      "peer tool call",
      {
        principal: "session:caller",
        operation: "thread_list",
        call: async (h, key) => {
          const scope = { principal: "session:caller", operation: "thread_list", idempotency_key: key }
          const store = h.get("A").store
          expect(await store.toolReceiptBegin({ ...scope, now: h.clock.now, args_hash: "h" })).toEqual({
            kind: "accepted",
          })
          expect(await store.toolReceiptSettle({ ...scope, now: h.clock.now, result: { kind: "ok" } })).toBe(true)
        },
      },
    ],
    [
      "keyed send",
      {
        principal: "session:A",
        operation: "deliver",
        call: async (h, key) => {
          const sent = await h.get("A").engine.deliver({
            sender: { kind: "session", durable_id: "A" },
            target: "B",
            text: "hello",
            idempotency_key: key,
          })
          expect(sent.kind).toBe("ok")
        },
      },
    ],
  ]

  test.each(keyedCalls)(
    "#given more expired receipts than one sweep may delete, one of them under the calling key #when a %s reuses that expired key #then the call deletes at most one batch of receipts in total, and the next call drains the rest",
    async (_name, entry) => {
      const h = (harness = createGatewayHarness())
      const t0 = h.clock.now
      h.session("A")
      h.session("B")
      expect(await h.get("A").store.journalMode()).toBe("wal")
      const db = new Database(gatewayDatabasePath(h.agentDir))
      const prefix = "old"
      const expired = () =>
        Number(
          (db.query("SELECT COUNT(*) AS n FROM receipts WHERE expires_at <= ?").get(h.clock.now) as { n: number }).n,
        )
      try {
        db.run("PRAGMA busy_timeout = 5000")
        const total = RETENTION_SWEEP_BATCH + 44
        db.transaction(() => {
          for (let index = 1; index <= total; index++) {
            db.run(
              "INSERT INTO receipts (principal, operation, idempotency_key, args_hash, status, delivery_id, owner_instance, created_at, updated_at, expires_at) VALUES (?, ?, ?, 'h', 'completed', NULL, 'i', ?, ?, ?)",
              [entry.principal, entry.operation, `${prefix}-${index}`, t0, t0, t0 + DAY],
            )
          }
        })()
        h.clock.now = t0 + 2 * DAY
        const before = expired()
        await entry.call(h, `${prefix}-${total}`)
        const afterFirst = expired()
        await entry.call(h, `${prefix}-fresh`)
        expect({ before, deletedByFirstCall: before - afterFirst, leftAfterSecondCall: expired() }).toEqual({
          before: total,
          deletedByFirstCall: RETENTION_SWEEP_BATCH,
          leftAfterSecondCall: 0,
        })
      } finally {
        db.close()
      }
    },
  )

  test("#given a sweep that hit no batch bound #when another write follows within the sweep interval #then it deletes nothing, and the first write after the interval does", async () => {
    const h = (harness = createGatewayHarness())
    const t0 = h.clock.now
    const store = h.store()
    expect(await store.journalMode()).toBe("wal")
    const db = new Database(gatewayDatabasePath(h.agentDir))
    try {
      db.run("PRAGMA busy_timeout = 5000")
      insertDelivery(db, "d-swept", "refused", t0, { seq: 1 })
      h.clock.now = t0 + DELIVERY_RETENTION_MS + 1
      await toolCall(store, h.clock.now, "first")
      expect(ids(db, "deliveries", "delivery_id")).toEqual([])
      insertDelivery(db, "d-waits", "refused", t0, { seq: 2 })
      h.clock.now += RETENTION_SWEEP_INTERVAL_MS - 1
      await toolCall(store, h.clock.now, "second")
      expect(ids(db, "deliveries", "delivery_id")).toEqual(["d-waits"])
      h.clock.now += 1
      await toolCall(store, h.clock.now, "third")
      expect(ids(db, "deliveries", "delivery_id")).toEqual([])
    } finally {
      db.close()
    }
  })
})

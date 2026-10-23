import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { mkdirSync } from "node:fs"

import { gatewayDatabasePath, gatewayRootDirectory } from "./paths"
import { renderDeliveryText } from "./provenance"
import { GATEWAY_MIGRATIONS } from "./schema"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })

function insert(db: Database, id: string, envelope: unknown): void {
  db.run("INSERT INTO deliveries (delivery_id, target_durable_id, seq, sender, envelope, body, bytes, mode_requested, state, root_id, hop, created_at, updated_at, expires_at) VALUES (?, 'receiver', 1, 'session:sender', ?, 'hello', 5, 'auto', 'queued', 'root-1', 1, 1, 1, 9999999999999)", [id, JSON.stringify(envelope)])
}

test("#given a v7 row with no provenance #when migrated and read #then the envelope is preserved and rendered as not recorded", async () => {
  const h = (harness = createGatewayHarness())
  mkdirSync(gatewayRootDirectory(h.agentDir), { recursive: true })
  const db = new Database(gatewayDatabasePath(h.agentDir))
  const envelope = { origin: { session: "sender" }, actor: "planner", via: ["sender"], root_id: "root-1", hop: 1, delivery_id: "old" }
  try {
    for (const step of GATEWAY_MIGRATIONS.slice(0, 7)) for (const sql of step) db.exec(sql)
    db.exec("PRAGMA user_version = 7")
    insert(db, "old", envelope)
  } finally { db.close() }
  const store = h.store()
  const row = (await store.deliveryView("old"))?.row
  if (row === undefined) throw new Error("old row was lost")
  expect(row.envelope).toEqual(envelope)
  expect(renderDeliveryText(row).split("\n")[0]).toStartWith("From (provenance not recorded) [OMO_GATEWAY v=1 ")
  const migrated = new Database(gatewayDatabasePath(h.agentDir))
  try {
    expect(migrated.query("PRAGMA user_version").get()).toEqual({ user_version: GATEWAY_MIGRATIONS.length })
    migrated.run("UPDATE deliveries SET state = 'applied' WHERE delivery_id = 'old'")
    expect(() => insert(migrated, "new", envelope)).toThrow("delivery provenance is required")
  } finally { migrated.close() }
})

test("#given current storage #when inserting missing or malformed provenance #then the database rejects it without writing a row", async () => {
  const h = (harness = createGatewayHarness())
  await h.store().identity()
  const db = new Database(gatewayDatabasePath(h.agentDir))
  try {
    for (const provenance of [undefined, null, {}, { workspace: "Example" }, { workspace: "", project: "project" }, { workspace: "Example", project: 1 }, { workspace: "Example", project: "project", lane: null }]) {
      expect(() => insert(db, "invalid", { provenance })).toThrow("delivery provenance is required")
    }
    expect(db.query("SELECT count(*) AS n FROM deliveries").get()).toEqual({ n: 0 })
    insert(db, "valid", { provenance: { workspace: "Example", project: "project" } })
    expect(db.query("SELECT count(*) AS n FROM deliveries").get()).toEqual({ n: 1 })
  } finally { db.close() }
})

test("#given a JavaScript caller without provenance #when enqueuing through the worker #then the insert is refused before recording a receipt", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  const request = {
    now: h.clock.now, delivery_id: "new", target_durable_id: "receiver",
    sender_principal: "session:sender", sender_node: "sender", sender_turn: null,
    cause_delivery_id: null, claimed_root_id: null, origin: { session: "sender" },
    actor: "planner", body: "hello", mode: "auto", expected_turn_id: null, binding: null,
    receipt: { idempotency_key: "missing-provenance", args_hash: "hash" }, endpoint_kind: null,
  }
  expect(await Reflect.apply(store.enqueue, store, [request])).toMatchObject({ kind: "refused", code: "invalid_arguments" })
  expect(await store.list()).toEqual([])
  const valid = { ...request, provenance: { workspace: "Example", project: "project", lane: "review", session: "planner" } }
  expect(await Reflect.apply(store.enqueue, store, [valid])).toMatchObject({ kind: "inserted" })
  await store.dispose()
  const reopened = h.store()
  expect((await reopened.deliveryView("new"))?.row.envelope.provenance).toEqual(valid.provenance)
})

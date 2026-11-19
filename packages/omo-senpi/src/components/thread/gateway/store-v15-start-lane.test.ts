import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { afterEach, expect, test } from "bun:test"

import { gatewayDatabasePath } from "./paths"
import { GATEWAY_MIGRATIONS } from "./schema"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import { settled } from "./testing/settled"

/**
 * Storage contract of schema v15 (#14333): `deliveries.mode_effective` records `start`, the lane an idle session's
 * delivery takes. SQLite cannot widen a CHECK in place, so v15 rebuilds `deliveries`; a store the v14 build left must
 * come through with every row, column, index and trigger as it was, and that v14 build must refuse the result.
 */
const V14 = 14

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

const ENVELOPE = (id: string) =>
  JSON.stringify({
    provenance: { workspace: "w", project: "p" },
    origin: { session: "A" },
    actor: "A",
    via: [],
    root_id: "root-1",
    hop: 1,
    delivery_id: id,
  })

/** A v14 row with every column set, the later-added ones included, so a dropped or reordered column shows. */
const DELIVERY_ROW = (id: string, seq: number, effective: string | null, extra: Partial<Record<string, string>> = {}) =>
  `INSERT INTO deliveries (delivery_id, target_durable_id, seq, sender, sender_turn, envelope, body, bytes, mode_requested,
     mode_effective, expected_turn_id, state, reason, admitted_by, claimed_at, attempt, admission_kind, turn_epoch, root_id,
     hop, created_at, updated_at, expires_at, binding_id, binding_revision, actor_user_id, wait_kind, ledger_id,
     verbatim_text, verbatim_display_text)
   VALUES ('${id}', 'B', ${seq}, 'A', 'turn-1', '${ENVELOPE(id)}', 'body ${id}', 6, 'auto',
     ${effective === null ? "NULL" : `'${effective}'`}, 3, 'admitted', NULL, '{"pid":1}', 100, 1, 'queued', 3, 'root-1',
     1, 10, 20, 30, ${extra.binding ?? "NULL"}, ${extra.binding === undefined ? "NULL" : "1"}, ${extra.actor ?? "NULL"},
     ${extra.wait ?? "NULL"}, ${extra.ledger ?? "NULL"}, ${extra.ledger === undefined ? "NULL" : "'verbatim'"},
     ${extra.ledger === undefined ? "NULL" : "'shown'"})`

/** A real v14 store (the v1..v14 migrations on a fresh DB) holding deliveries in each lane, plus `extra` statements. */
function v14Fixture(path: string, extra: readonly string[] = []): void {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.exec("PRAGMA foreign_keys = ON")
  db.exec("BEGIN")
  for (const step of GATEWAY_MIGRATIONS.slice(0, V14)) for (const statement of step) db.exec(statement)
  db.exec(`PRAGMA user_version = ${V14}`)
  db.exec("COMMIT")
  db.exec(DELIVERY_ROW("d-steer", 1, "steer", { actor: "'U1'" }))
  db.exec(DELIVERY_ROW("d-follow", 2, "follow_up", { wait: "'approval'", binding: "'bnd-1'" }))
  db.exec(DELIVERY_ROW("d-queued", 3, null, { ledger: "'device:b/d-queued'" }))
  db.exec("DELETE FROM deliveries WHERE delivery_id = 'd-steer'")
  db.exec(DELIVERY_ROW("d-steer", 4, "steer", { actor: "'U1'" }))
  for (const statement of extra) db.exec(statement)
  db.close()
}

function snapshot(path: string) {
  const db = new Database(path)
  try {
    return {
      version: (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
      rows: db.query("SELECT rowid AS row_id, * FROM deliveries ORDER BY rowid").all(),
      columns: db.query("SELECT name, type, \"notnull\", dflt_value, pk FROM pragma_table_info('deliveries')").all(),
      objects: db.query("SELECT type, name FROM sqlite_schema WHERE tbl_name = 'deliveries' ORDER BY type, name").all(),
      registry: db.query("SELECT type, name, owner FROM extension_objects ORDER BY type, name").all(),
      foreignKeyViolations: (db.query("PRAGMA foreign_key_check").all() as unknown[]).length,
    }
  } finally {
    db.close()
  }
}

async function openAndMigrate(h: GatewayHarness): Promise<void> {
  const store = h.store()
  try {
    await store.identity()
  } finally {
    await store.dispose()
  }
}

test("#given a v14 store holding deliveries in every lane #when the current build opens it #then v15 keeps every row, column, index and trigger, and a delivery can record start", async () => {
  const h = (harness = createGatewayHarness())
  const path = gatewayDatabasePath(h.agentDir)
  v14Fixture(path)
  const before = snapshot(path)
  const insertStart = () => {
    const db = new Database(path)
    try {
      db.exec(DELIVERY_ROW("d-start", 5, "start"))
    } finally {
      db.close()
    }
  }
  expect(insertStart).toThrow("CHECK constraint failed")

  await openAndMigrate(h)

  const after = snapshot(path)
  expect(after.version).toBe(V14 + 1)
  expect(after.version).toBe(GATEWAY_MIGRATIONS.length)
  expect(after.rows).toEqual(before.rows)
  expect(after.columns).toEqual(before.columns)
  expect(after.objects).toEqual(before.objects)
  expect(after.registry).toEqual(before.registry)
  expect(after.foreignKeyViolations).toBe(0)
  insertStart()
  const db = new Database(path)
  try {
    expect(db.query("SELECT mode_effective FROM deliveries WHERE delivery_id = 'd-start'").get()).toEqual({
      mode_effective: "start",
    })
    // The v8 provenance trigger came back with the table: a delivery with no provenance is still refused.
    expect(() =>
      db.exec(DELIVERY_ROW("d-bare", 6, null).replace(ENVELOPE("d-bare"), JSON.stringify({ origin: {} }))),
    ).toThrow("delivery provenance is required")
    // So did the ledger index: a second row under one ledger key is refused.
    expect(() => db.exec(DELIVERY_ROW("d-dup", 7, null, { ledger: "'device:b/d-queued'" }))).toThrow("UNIQUE")
  } finally {
    db.close()
  }
})

test("#given an extension table referencing deliveries ON DELETE CASCADE #when migrated to v15 #then the referencing rows are not cascade-deleted", async () => {
  const h = (harness = createGatewayHarness())
  const path = gatewayDatabasePath(h.agentDir)
  v14Fixture(path, [
    "CREATE TABLE alpha_refs (id INTEGER PRIMARY KEY, delivery_id TEXT REFERENCES deliveries ON DELETE CASCADE)",
    "INSERT INTO alpha_refs (id, delivery_id) VALUES (1, 'd-follow'), (2, 'd-queued')",
  ])
  await openAndMigrate(h)
  const db = new Database(path)
  try {
    expect(db.query("SELECT * FROM alpha_refs ORDER BY id").all()).toEqual([
      { id: 1, delivery_id: "d-follow" },
      { id: 2, delivery_id: "d-queued" },
    ])
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(V14 + 1)
  } finally {
    db.close()
  }
})

test("#given an extension row orphaned on deliveries #when migrated #then foreign_key_check rolls back to v14 and the rebuild leaves nothing behind", async () => {
  const h = (harness = createGatewayHarness())
  const path = gatewayDatabasePath(h.agentDir)
  v14Fixture(path, [
    "PRAGMA foreign_keys = OFF",
    "CREATE TABLE alpha_refs (id INTEGER PRIMARY KEY, delivery_id TEXT REFERENCES deliveries)",
    "INSERT INTO alpha_refs (id, delivery_id) VALUES (1, 'd-missing')",
    "PRAGMA foreign_keys = ON",
  ])
  const before = snapshot(path)
  const store = h.store()
  const opened = await settled(store.identity())
  await store.dispose()
  expect((opened.error as { code?: string } | undefined)?.code).toBe("gateway_migration_failed")
  expect(String(opened.error)).toContain("deliveries")
  const after = snapshot(path)
  expect(after.version).toBe(V14)
  expect({ rows: after.rows, columns: after.columns, objects: after.objects }).toEqual({
    rows: before.rows,
    columns: before.columns,
    objects: before.objects,
  })
})

test("#given a store the current build migrated to v15 #when the v14 build's worker opens it #then it is refused as gateway_schema_too_new and the store is untouched", async () => {
  const h = (harness = createGatewayHarness())
  const path = gatewayDatabasePath(h.agentDir)
  v14Fixture(path)
  await openAndMigrate(h)
  const migrated = snapshot(path)

  const old = h.store({ workerModuleUrl: new URL("./testing/v14/gateway-store-worker.mjs", import.meta.url) })
  const listed = await settled(old.list())
  await old.dispose()
  expect(listed.error).toMatchObject({ code: "gateway_schema_too_new" })
  expect(String(listed.error)).toContain(`schema ${V14 + 1} is newer than this binary's supported version ${V14}`)
  expect(snapshot(path)).toEqual(migrated)
})

import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { afterEach, expect, test } from "bun:test"

import { gatewayDatabasePath } from "./paths"
import { GATEWAY_MIGRATIONS } from "./schema"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })

const BINDING_ROW = (id: string, platform: string, seq?: number) =>
  `INSERT INTO bindings (${seq === undefined ? "" : "seq, "}binding_id, revision, status, platform, account_id, chat_id, thread_id, session_realm_id, session_durable_id, direction_inbound, direction_outbound, inbound_mode, outbound_events, policy_id, created_at, updated_at, lease_started_at)
   VALUES (${seq === undefined ? "" : `${seq}, `}'${id}', 1, 'active', '${platform}', 'acct', 'c1', 't1', 'realm', 'S-${id}', 1, 1, 'auto', '[]', 'default', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`

/** A real v6 store: the v1..v6 migrations applied to a fresh DB, with one binding whose newest row is then deleted. */
function v6Fixture(path: string, extra: readonly string[]): void {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.exec("PRAGMA foreign_keys = ON")
  db.exec("BEGIN")
  const v6 = GATEWAY_MIGRATIONS.slice(0, -1)
  for (const step of v6) for (const statement of step) db.exec(statement)
  db.exec(`PRAGMA user_version = ${v6.length}`)
  db.exec("COMMIT")
  db.exec(BINDING_ROW("bnd-keep", "slack"))
  db.exec(BINDING_ROW("bnd-deleted", "custom"))
  db.exec("DELETE FROM bindings WHERE binding_id = 'bnd-deleted'")
  for (const statement of extra) db.exec(statement)
  db.close()
}

/** Opens (and so migrates) the store, then releases its worker connection on success AND failure, so a direct read afterwards never races it. */
async function openAndMigrate(h: GatewayHarness): Promise<void> {
  const store = h.store()
  try {
    await store.identity()
  } finally {
    await store.dispose()
  }
}

function snapshot(path: string) {
  const db = new Database(path)
  try {
    return {
      version: (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
      rows: db.query("SELECT binding_id, platform FROM bindings ORDER BY seq").all(),
      sequence: (db.query("SELECT seq FROM sqlite_sequence WHERE name = 'bindings'").get() as { seq: number } | null)?.seq ?? null,
      hasWhatsapp: ((db.query("SELECT sql FROM sqlite_schema WHERE name = 'bindings'").get() as { sql: string }).sql ?? "").includes("'whatsapp'"),
      indexes: db.query("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('bindings_one_active_thread','bindings_session') ORDER BY name").all(),
      integrity: (db.query("PRAGMA foreign_key_check").all() as unknown[]).length,
    }
  } finally { db.close() }
}

test("#given a real v6 store with a deleted newest binding #when migrated to v7 #then rows, indexes and the AUTOINCREMENT high-water survive, and whatsapp binds", async () => {
  const h = (harness = createGatewayHarness())
  const path = gatewayDatabasePath(h.agentDir)
  v6Fixture(path, [])
  await openAndMigrate(h)
  const after = snapshot(path)
  expect(after.version).toBe(GATEWAY_MIGRATIONS.length)
  expect(after.rows).toEqual([{ binding_id: "bnd-keep", platform: "slack" }])
  expect(after.sequence).toBe(2)
  expect(after.hasWhatsapp).toBe(true)
  expect(after.indexes).toEqual([{ name: "bindings_one_active_thread" }, { name: "bindings_session" }])
  expect(after.integrity).toBe(0)
  const db = new Database(path)
  db.exec(BINDING_ROW("bnd-wa", "whatsapp"))
  db.close()
})

test("#given an extension table referencing bindings ON DELETE CASCADE #when migrated to v7 #then the referencing rows are NOT cascade-deleted", async () => {
  const h = (harness = createGatewayHarness())
  const path = gatewayDatabasePath(h.agentDir)
  v6Fixture(path, [
    "CREATE TABLE alpha_refs (id INTEGER PRIMARY KEY, binding_seq INTEGER REFERENCES bindings ON DELETE CASCADE)",
    "INSERT INTO alpha_refs (id, binding_seq) VALUES (1, 1), (2, 1)",
  ])
  await openAndMigrate(h)
  const db = new Database(path)
  try {
    expect(db.query("SELECT * FROM alpha_refs ORDER BY id").all()).toEqual([{ id: 1, binding_seq: 1 }, { id: 2, binding_seq: 1 }])
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(GATEWAY_MIGRATIONS.length)
  } finally { db.close() }
})

test("#given an extension table with a plain REFERENCES to bindings #when migrated to v7 #then the store still opens and the rows survive", async () => {
  const h = (harness = createGatewayHarness())
  const path = gatewayDatabasePath(h.agentDir)
  v6Fixture(path, [
    "CREATE TABLE alpha_refs (id INTEGER PRIMARY KEY, binding_seq INTEGER REFERENCES bindings)",
    "INSERT INTO alpha_refs (id, binding_seq) VALUES (1, 1)",
  ])
  await openAndMigrate(h)
  const db = new Database(path)
  try {
    expect(db.query("SELECT * FROM alpha_refs").all()).toEqual([{ id: 1, binding_seq: 1 }])
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(GATEWAY_MIGRATIONS.length)
  } finally { db.close() }
})

test("#given an extension row orphaned on bindings (a pre-existing violation) #when migrated #then foreign_key_check rolls back to v6 with a clear error", async () => {
  const h = (harness = createGatewayHarness())
  const path = gatewayDatabasePath(h.agentDir)
  v6Fixture(path, [
    "PRAGMA foreign_keys = OFF",
    "CREATE TABLE alpha_refs (id INTEGER PRIMARY KEY, binding_seq INTEGER REFERENCES bindings)",
    "INSERT INTO alpha_refs (id, binding_seq) VALUES (1, 99)",
    "PRAGMA foreign_keys = ON",
  ])
  const store = h.store()
  // The failed migration closes the database in the worker before the error crosses back; wait for
  // that close (not just the error) so the reopen below never races the worker's teardown.
  const closed = new Promise<void>((resolve, reject) => {
    const off = store.onEvent((event) => {
      if (event.kind === "store_closed") { off(); resolve() }
    })
    setTimeout(() => { off(); reject(new Error("waited for the worker to close the failed migration's database; store_closed never fired")) }, 15000).unref?.()
  })
  let error: unknown
  try {
    await store.identity()
  } catch (caught) {
    error = caught
  }
  // the error crosses the store-worker boundary, so it arrives as a plain Error carrying the code
  expect((error as { code?: string }).code).toBe("gateway_migration_failed")
  expect(String(error)).toContain("bindings")
  await closed
  // busy_timeout=0: a still-held lock fails immediately instead of depending on timing.
  const db = new Database(path)
  db.exec("PRAGMA busy_timeout = 0")
  try {
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(GATEWAY_MIGRATIONS.length - 1)
    expect(db.query("SELECT * FROM alpha_refs").all()).toEqual([{ id: 1, binding_seq: 99 }])
  } finally { db.close() }
})

test("#given a v6 store whose extension already holds an orphaned row not on bindings #when migrated #then the pre-existing orphan does not block the upgrade", async () => {
  const h = (harness = createGatewayHarness())
  const path = gatewayDatabasePath(h.agentDir)
  // an orphan on another table (created while foreign keys were off) is not this step's to police
  v6Fixture(path, [
    "PRAGMA foreign_keys = OFF",
    "CREATE TABLE alpha_parent (id INTEGER PRIMARY KEY)",
    "CREATE TABLE alpha_refs (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES alpha_parent)",
    "INSERT INTO alpha_refs (id, parent_id) VALUES (1, 99)",
    "PRAGMA foreign_keys = ON",
  ])
  await openAndMigrate(h)
  const db = new Database(path)
  try {
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(GATEWAY_MIGRATIONS.length)
  } finally { db.close() }
})

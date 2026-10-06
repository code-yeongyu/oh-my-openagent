import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"

import { checkExtensionSchema, ExtensionSchemaViolation, sqliteName } from "./extension-sql"
import { gatewayDatabasePath } from "./paths"
import { Sql, type SqlRow } from "./sql"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })
const moduleUrl = new URL("./testing/store-extension.mjs", import.meta.url).href
const registration = (name: string) => ({ name, moduleUrl, migrations: [[`CREATE TABLE ${name}_items (id INTEGER PRIMARY KEY, value TEXT)`, `INSERT INTO ${name}_items VALUES (1, 'keep')`]] })

test.each([
  "SELECT value FROM gateway_meta",
  "UPDATE gateway_meta SET value = 'changed'",
  "DELETE FROM gateway_meta WHERE key = 'fixture-secret'",
  "DELETE FROM gateway_meta",
])("#given a core-colliding gateway namespace #when attempting %s #then registration and access are refused", async (sql) => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  const registered = await store.registerStoreExtension({ name: "gateway", moduleUrl, migrations: [] })
  const called = await store.extensionCall("gateway", "sql", { sql, ...(sql.startsWith("SELECT") ? { columns: ["value"] } : {}) })
  expect(registered).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
  expect(called).toMatchObject({ kind: "refused", code: "extension_unknown_name" })
  expect(await store.list()).toEqual([])
})

test.each([
  ["trigger", "CREATE TRIGGER alpha_trace AFTER INSERT ON alpha_items BEGIN UPDATE alpha_items SET value = 'trigger'; END"],
  ["view", "CREATE VIEW alpha_view AS SELECT * FROM alpha_items"],
])("#given an own-namespace %s #when migrating #then the whole step is refused", async (_kind, statement) => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  const descriptor = registration("alpha")
  expect(await store.registerStoreExtension({ ...descriptor, migrations: [[...descriptor.migrations[0], statement]] })).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
  const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
  try {
    expect(db.query("SELECT name FROM sqlite_schema WHERE name LIKE 'alpha_%'").all()).toEqual([])
    expect(db.query("SELECT * FROM extension_schema WHERE name = 'alpha'").all()).toEqual([])
  } finally { db.close() }
  expect(await store.journalMode()).toBe("wal")
})

test("#given persisted core ownership #when DELETE has no WHERE #then the core table remains protected", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration("alpha"))
  const db = new Database(gatewayDatabasePath(h.agentDir))
  try {
    db.exec("INSERT INTO gateway_meta (key, value) VALUES ('fixture-secret', 'synthetic')")
    expect(await store.extensionCall("alpha", "sql", { sql: "DELETE FROM gateway_meta" })).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
    expect(db.query("SELECT value FROM gateway_meta WHERE key = 'fixture-secret'").get()).toEqual({ value: "synthetic" })
    expect(db.query("SELECT owner FROM extension_objects WHERE type = 'table' AND name = 'gateway_meta'").get()).toEqual({ owner: null })
  } finally { db.close() }
})

test("#given two registered owners and an unowned lookalike #when SQL names another object #then prefixes never grant access", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration("alpha"))
  await store.registerStoreExtension(registration("beta"))
  const db = new Database(gatewayDatabasePath(h.agentDir))
  try {
    db.exec("CREATE TABLE alpha_unowned (id INTEGER); INSERT INTO alpha_unowned VALUES(99)")
    for (const sql of ["SELECT id FROM beta_items", "UPDATE beta_items SET value = 'bad'", "DELETE FROM beta_items", "DELETE FROM alpha_unowned"]) {
      expect(await store.extensionCall("alpha", "sql", { sql, ...(sql.startsWith("SELECT") ? { columns: ["id"] } : {}) })).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
    }
    expect(db.query("SELECT * FROM alpha_unowned").all()).toEqual([{ id: 99 }])
    expect(db.query("SELECT value FROM beta_items").all()).toEqual([{ value: "keep" }])
  } finally { db.close() }
})

test("#given persisted ownership #when reopening beside a new prefixed table #then ownership is retained rather than inferred again", async () => {
  const h = (harness = createGatewayHarness())
  const first = h.store()
  await first.registerStoreExtension(registration("alpha"))
  await first.dispose()
  const db = new Database(gatewayDatabasePath(h.agentDir))
  db.exec("CREATE TABLE alpha_lookalike (id INTEGER); INSERT INTO alpha_lookalike VALUES(99)")
  db.close()
  const reopened = h.store()
  expect((await reopened.registerStoreExtension(registration("alpha"))).kind).toBe("ok")
  expect(await reopened.extensionCall("alpha", "rows", { name: "alpha" })).toEqual({ kind: "ok", value: [{ id: 1, value: "keep" }] })
  expect(await reopened.extensionCall("alpha", "sql", { sql: "SELECT id FROM alpha_lookalike", columns: ["id"] })).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
  const read = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
  try {
    expect(read.query("SELECT owner FROM extension_objects WHERE type = 'table' AND name = 'alpha_items'").get()).toEqual({ owner: "alpha" })
    expect(read.query("SELECT * FROM extension_objects WHERE name = 'alpha_lookalike'").all()).toEqual([])
  } finally { read.close() }
})

test("#given the omo_gateway namespace #when registered #then own SQL succeeds while gateway_meta stays inaccessible", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  expect((await store.registerStoreExtension(registration("omo_gateway"))).kind).toBe("ok")
  expect(await store.extensionCall("omo_gateway", "rows", { name: "omo_gateway" })).toEqual({ kind: "ok", value: [{ id: 1, value: "keep" }] })
  expect(await store.extensionCall("omo_gateway", "sql", { sql: "SELECT value FROM gateway_meta", columns: ["value"] })).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
  expect(await store.registerStoreExtension({ name: "gateway", moduleUrl, migrations: [] })).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
  expect(await store.registerStoreExtension({ name: "thread", moduleUrl, migrations: [] })).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
})

test("#given owned DDL #when CREATE AS reads the core catalog #then internal schema access does not authorize that read", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration("alpha"))
  expect(await store.extensionCall("alpha", "sql", { sql: "CREATE TABLE alpha_catalog AS SELECT sql FROM sqlite_schema" })).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
})

test("#given a CTE over registered objects #when reading #then the CTE label is not mistaken for a persisted view", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration("alpha"))
  expect(await store.extensionCall("alpha", "sql", { sql: "WITH q AS (SELECT id FROM alpha_items) SELECT id FROM q", columns: ["id"] })).toEqual({ kind: "ok", value: [{ id: 1 }] })
})

test.each([
  "CREATE TRIGGER alpha_trace AFTER INSERT ON alpha_items BEGIN SELECT 1; END",
  "CREATE VIEW alpha_view AS SELECT * FROM alpha_items",
])("#given a forbidden schema effect bypassing statement authorization #when checked #then the diff guard rejects %s", async (statement) => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration("alpha"))
  // SQLite itself creates the object, through bun:sqlite: no extension statement guard runs.
  const db = new Database(gatewayDatabasePath(h.agentDir))
  const schema = () => ({
    objects: db.query("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name").all() as SqlRow[],
    owners: new Map((db.query("SELECT type, name, owner FROM extension_objects").all() as { type: string; name: string; owner: string | null }[])
      .map((row) => [`${row.type}:${sqliteName(row.name)}`, row.owner])),
  })
  // The guard must refuse before it records ownership, so its store connection is never reached.
  const unreached = (): never => { throw new Error("the schema diff guard wrote after a forbidden schema effect") }
  const sql = new Sql({ exec: unreached, setAuthorizer: unreached, function: () => undefined, close: () => undefined })
  db.exec("BEGIN IMMEDIATE")
  try {
    const before = schema()
    db.exec(statement)
    expect(() => checkExtensionSchema(sql, "alpha", before, schema())).toThrow(ExtensionSchemaViolation)
  } finally {
    db.exec("ROLLBACK")
    db.close()
  }
  expect(await store.list()).toEqual([])
})

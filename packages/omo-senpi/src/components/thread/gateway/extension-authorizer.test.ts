import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"

import { gatewayDatabasePath } from "./paths"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })

// Security contract: SQLite's authorizer denies an extension's view creation by itself. A view is
// one statement, so it passes the single-statement guard and reaches the authorizer; the message
// is the authorizer's own, which the later schema-diff guard cannot produce.
test("#given a single-statement view creation #when an extension runs it #then SQLite's authorizer denies the create itself", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension({ name: "alpha", moduleUrl: new URL("./testing/store-extension.mjs", import.meta.url).href, migrations: [["CREATE TABLE alpha_items (id INTEGER)"]] })
  expect(await store.extensionCall("alpha", "sql", { sql: "CREATE VIEW alpha_view AS SELECT id FROM alpha_items" }))
    .toEqual({ kind: "refused", code: "extension_schema_violation", message: "Extension alpha does not own alpha_view." })
  const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
  try {
    expect(db.query("SELECT name FROM sqlite_schema WHERE type = 'view'").all()).toEqual([])
  } finally { db.close() }
  expect(await store.list()).toEqual([])
})

// Trigger guards: a valid trigger body carries an inner `;`, so the single-statement guard refuses
// valid trigger text. Malformed trigger text (here, no `;` before END) passes that lexical guard,
// and SQLite calls CREATE_TRIGGER while parsing it, so the authorizer is the guard for it.
test("#given malformed trigger text that passes the single-statement guard #when migrated or run through tx.exec #then the authorizer refuses CREATE_TRIGGER and nothing changes", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  const moduleUrl = new URL("./testing/store-extension.mjs", import.meta.url).href
  const v1 = ["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, value TEXT)", "INSERT INTO alpha_items VALUES (1, 'keep')"]
  expect(await store.registerStoreExtension({ name: "alpha", moduleUrl, migrations: [v1] })).toEqual({ kind: "ok", value: { version: 1 } })
  const writer = new Database(gatewayDatabasePath(h.agentDir))
  try { writer.exec("INSERT INTO gateway_meta (key, value) VALUES ('fixture-sentinel', 'synthetic')") } finally { writer.close() }
  const snapshot = () => {
    const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
    try {
      return {
        schema: db.query("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name").all(),
        versions: db.query("SELECT name, version FROM extension_schema ORDER BY name").all(),
        owners: db.query("SELECT type, name, owner FROM extension_objects ORDER BY type, name").all(),
        meta: db.query("SELECT key, value FROM gateway_meta ORDER BY key").all(),
        items: db.query("SELECT id, value FROM alpha_items ORDER BY id").all(),
      }
    } finally { db.close() }
  }
  const before = snapshot()
  expect(before.meta).toContainEqual({ key: "fixture-sentinel", value: "synthetic" })
  const malformed = "CREATE TRIGGER alpha_t AFTER INSERT ON alpha_items BEGIN DELETE FROM gateway_meta END"
  // The authorizer's own denial; a syntax error or the single-statement refusal reads differently.
  const authorizerRefusal = { kind: "refused", code: "extension_schema_violation", message: "Extension alpha does not own alpha_t." } as const
  expect(await store.registerStoreExtension({ name: "alpha", moduleUrl, migrations: [v1, [malformed]] })).toEqual(authorizerRefusal)
  expect(snapshot()).toEqual(before)
  expect(await store.extensionCall("alpha", "sql", { sql: malformed })).toEqual(authorizerRefusal)
  expect(snapshot()).toEqual(before)
  expect(await store.list()).toEqual([])
  // Two migrations and two calls through the store worker, each answered in turn; no event to await,
  // so a loaded runner only needs room past the 5 s default.
}, 15_000)

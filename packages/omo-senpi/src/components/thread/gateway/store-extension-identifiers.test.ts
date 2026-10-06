import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"

import { gatewayDatabasePath } from "./paths"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })
const moduleUrl = new URL("./testing/store-extension.mjs", import.meta.url).href
const registration = (name: string) => ({ name, moduleUrl, migrations: [[`CREATE TABLE ${name}_items (id INTEGER PRIMARY KEY)`, `INSERT INTO ${name}_items VALUES (7)`]] })

test.each(["ALPHA_ITEMS", "MAIN.alpha_items", '"MAIN"."ALPHA_ITEMS"'])("#given owned table spelling %s #when reading #then SQLite case and schema rules apply", async (table) => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration("alpha"))
  expect(await store.extensionCall("alpha", "sql", { sql: `SELECT id FROM ${table}`, columns: ["id"] })).toEqual({ kind: "ok", value: [{ id: 7 }] })
})

test("#given uppercase owned DDL #when creating and reopening #then canonical table and index ownership persists", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration("alpha"))
  expect((await store.extensionCall("alpha", "sql", { sql: "CREATE TABLE MAIN.ALPHA_UPPER (id TEXT PRIMARY KEY)" })).kind).toBe("ok")
  expect((await store.extensionCall("alpha", "sql", { sql: "INSERT INTO alpha_upper VALUES ('kept')" })).kind).toBe("ok")
  await store.dispose()
  const reopened = h.store()
  expect((await reopened.registerStoreExtension(registration("alpha"))).kind).toBe("ok")
  expect(await reopened.extensionCall("alpha", "sql", { sql: "SELECT id FROM MAIN.ALPHA_UPPER", columns: ["id"] })).toEqual({ kind: "ok", value: [{ id: "kept" }] })
  const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
  try {
    expect(db.query("SELECT name, owner FROM extension_objects WHERE name IN ('alpha_upper', 'sqlite_autoindex_alpha_upper_1') ORDER BY name").all()).toEqual([
      { name: "alpha_upper", owner: "alpha" }, { name: "sqlite_autoindex_alpha_upper_1", owner: "alpha" },
    ])
  } finally { db.close() }
})

test.each(["GATEWAY_META", "MAIN.gateway_meta", '"MAIN"."GATEWAY_META"'])("#given core table spelling %s #when accessed #then case folding never grants ownership", async (table) => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration("alpha"))
  expect(await store.extensionCall("alpha", "sql", { sql: `DELETE FROM ${table}` })).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
})

test.each([["alpha", "alpha_beta"], ["alpha_beta", "alpha"]])("#given registration order %s then %s #when namespaces overlap #then both own only their actual objects", async (first, second) => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  for (const name of [first, second]) expect((await store.registerStoreExtension(registration(name))).kind).toBe("ok")
  for (const [owner, other] of [[first, second], [second, first]]) {
    expect(await store.extensionCall(owner, "sql", { sql: `SELECT id FROM ${owner}_items`, columns: ["id"] })).toEqual({ kind: "ok", value: [{ id: 7 }] })
    expect(await store.extensionCall(owner, "sql", { sql: `DELETE FROM ${other}_items` })).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
  }
})

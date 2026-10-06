import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"

import { gatewayDatabasePath } from "./paths"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })
const moduleUrl = new URL("./testing/store-extension.mjs", import.meta.url).href

test.each([
  ["TEXT primary key", "id TEXT PRIMARY KEY, value TEXT", "'key', 'value'"],
  ["composite primary key", "id TEXT, value TEXT, PRIMARY KEY (id, value)", "'key', 'value'"],
  ["UNIQUE column", "id INTEGER PRIMARY KEY, value TEXT UNIQUE", "1, 'value'"],
])("#given an extension with a %s #when migrating #then its automatic index belongs to the table owner", async (_kind, columns, values) => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  expect(await store.registerStoreExtension({
    name: "alpha", moduleUrl, migrations: [[`CREATE TABLE alpha_items (${columns})`]],
  })).toEqual({ kind: "ok", value: { version: 1 } })
  expect(await store.extensionCall("alpha", "sql", { sql: `INSERT INTO alpha_items VALUES (${values})` })).toMatchObject({ kind: "ok" })
  expect(await store.extensionCall("alpha", "sql", { sql: "REINDEX alpha_items" })).toMatchObject({ kind: "ok" })
  const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
  try {
    expect(db.query("SELECT o.owner, s.tbl_name FROM sqlite_schema s JOIN extension_objects o ON o.type=s.type AND o.name=s.name WHERE s.type='index' AND s.tbl_name='alpha_items' AND s.sql IS NULL").all()).toEqual([{ owner: "alpha", tbl_name: "alpha_items" }])
    expect(db.query("SELECT count(*) AS n FROM alpha_items").get()).toEqual({ n: 1 })
  } finally { db.close() }
})

test("#given a core automatic index #when an extension reindexes it #then core ownership remains protected", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  expect((await store.registerStoreExtension({ name: "alpha", moduleUrl, migrations: [] })).kind).toBe("ok")
  expect(await store.extensionCall("alpha", "sql", { sql: "REINDEX sqlite_autoindex_gateway_meta_1" })).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
  const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
  try {
    expect(db.query("SELECT owner FROM extension_objects WHERE type='index' AND name='sqlite_autoindex_gateway_meta_1'").get()).toEqual({ owner: null })
  } finally { db.close() }
  expect(await store.list()).toEqual([])
})

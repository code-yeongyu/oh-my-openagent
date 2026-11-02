import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"

import { gatewayDatabasePath } from "./paths"
import { GATEWAY_MIGRATIONS } from "./schema"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import { settled } from "./testing/settled"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })

test("#given a newer core schema #when an older supported version opens it #then typed refusal preserves the database", async () => {
  const h = (harness = createGatewayHarness())
  const initial = h.store()
  await initial.identity()
  await initial.dispose()
  const path = gatewayDatabasePath(h.agentDir)
  const db = new Database(path)
  const futureVersion = GATEWAY_MIGRATIONS.length + 1
  db.exec(`PRAGMA user_version = ${futureVersion}; INSERT INTO gateway_meta VALUES ('future-fixture', 'keep')`)
  db.close()
  const exits: Promise<unknown>[] = []
  const store = h.store({ _test: { onWorkerStarted: (worker) => exits.push(new Promise((resolve) => worker.once("exit", resolve))) } })
  expect(await store.registerStoreExtension({ name: "alpha", moduleUrl: new URL("./testing/store-extension.mjs", import.meta.url).href, migrations: [] })).toMatchObject({ kind: "refused", code: "gateway_schema_too_new" })
  expect(await store.extensionCall("alpha", "rows", { name: "alpha" })).toMatchObject({ kind: "refused", code: "gateway_schema_too_new" })
  const listed = await settled(store.list())
  expect({ value: listed.value, error: listed.error }).toMatchObject({ value: undefined, error: { code: "gateway_schema_too_new" } })
  // Every refused open terminates its worker. Once they have all exited, the last connection has
  // removed the WAL sidecars a read-only connection would need; a plain connection that only
  // reads writes nothing.
  await Promise.all(exits)
  expect(exits).toHaveLength(3)
  const check = new Database(path)
  try {
    expect(check.query("PRAGMA user_version").get()).toEqual({ user_version: futureVersion })
    expect(check.query("SELECT value FROM gateway_meta WHERE key='future-fixture'").get()).toEqual({ value: "keep" })
    expect(check.query("SELECT * FROM extension_schema").all()).toEqual([])
  } finally { check.close() }
})

test.each([
  ["a fresh handle", true],
  ["an already registered handle", false],
] as const)("#given a newer extension schema #when %s registers older migrations #then refusal preserves storage and worker health", async (_kind, reopen) => {
  const h = (harness = createGatewayHarness())
  const initial = h.store()
  const descriptor = {
    name: "alpha", moduleUrl: new URL("./testing/store-extension.mjs", import.meta.url).href,
    migrations: [["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, value TEXT)"], ["INSERT INTO alpha_items VALUES (7, 'preserved')"]],
  }
  expect(await initial.registerStoreExtension(descriptor)).toEqual({ kind: "ok", value: { version: 2 } })
  const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
  try {
    const before = {
      version: db.query("SELECT * FROM extension_schema WHERE name = 'alpha'").get(),
      owners: db.query("SELECT * FROM extension_objects ORDER BY type, name").all(),
      dataVersion: db.query("PRAGMA data_version").get(),
    }
    if (reopen) await initial.dispose()
    const store = reopen ? h.store() : initial
    expect(await store.registerStoreExtension({ ...descriptor, migrations: [["DROP TABLE alpha_items"]] })).toMatchObject({ kind: "refused", code: "gateway_schema_too_new" })
    expect(await store.list()).toEqual([])
    expect(db.query("SELECT * FROM extension_schema WHERE name = 'alpha'").get()).toEqual(before.version)
    expect(db.query("SELECT * FROM extension_objects ORDER BY type, name").all()).toEqual(before.owners)
    expect(db.query("PRAGMA data_version").get()).toEqual(before.dataVersion)
    expect(db.query("SELECT * FROM alpha_items").all()).toEqual([{ id: 7, value: "preserved" }])
    if (reopen) {
      // The refused registration never replaced the persisted one: the fresh handle loads that and reads the preserved row.
      expect(await store.extensionCall("alpha", "rows", { name: "alpha" })).toEqual({ kind: "ok", value: [{ id: 7, value: "preserved" }] })
      expect(await store.registerStoreExtension(descriptor)).toEqual({ kind: "ok", value: { version: 2 } })
    }
    expect(await store.extensionCall("alpha", "rows", { name: "alpha" })).toEqual({ kind: "ok", value: [{ id: 7, value: "preserved" }] })
    expect(await store.extensionCall("alpha", "put", { name: "alpha", id: 8, value: "healthy" })).toEqual({ kind: "ok", value: { value: "healthy" } })
  } finally { db.close() }
})

import { afterEach, expect, test } from "bun:test"

import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })
const moduleUrl = new URL("./testing/store-extension.mjs", import.meta.url).href
const registration = { name: "alpha", moduleUrl, migrations: [["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, at TEXT)", "INSERT INTO alpha_items VALUES (1, 'b'), (2, 'a'), (3, 'c')"]] }

async function read(sql: string, orderBy: string) {
  harness = createGatewayHarness()
  const store = harness.store()
  await store.registerStoreExtension(registration)
  return await store.extensionCall("alpha", "sql", { sql, columns: ["id"], orderBy })
}

test.each(["at, id", "at DESC", "at COLLATE NOCASE ASC, id", "at NULLS LAST"])("#given orderBy %s #when reading #then rows come back in that order", async (orderBy) => {
  expect(await read("SELECT id, at FROM alpha_items", orderBy)).toMatchObject({ kind: "ok" })
})

test("#given a LIMIT in the statement and columns in orderBy #when reading #then the first rows come back ordered", async () => {
  expect(await read("SELECT id, at FROM alpha_items ORDER BY at, id LIMIT 2", "at, id")).toEqual({ kind: "ok", value: [{ id: 2 }, { id: 1 }] })
})

test.each(["at LIMIT 2", "at LIMIT 2 OFFSET 1", "alpha_items.at", "at, id; DELETE FROM alpha_items", "lower(at)", ""])("#given orderBy %p #when reading #then extension_schema_violation names the column-list rule", async (orderBy) => {
  const result = await read("SELECT id, at FROM alpha_items", orderBy)
  expect(result).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
  expect(result.kind === "refused" && result.message).toContain("orderBy must list the statement's output columns")
})

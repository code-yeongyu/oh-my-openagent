import { afterEach, expect, test } from "bun:test"

import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })
const moduleUrl = new URL("./testing/store-extension.mjs", import.meta.url).href
const registration = { name: "alpha", moduleUrl, migrations: [["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, at TEXT)", "INSERT INTO alpha_items VALUES (1, 'b'), (2, 'a'), (3, 'B'), (4, NULL)"]] }

async function read(sql: string, orderBy: string) {
  harness = createGatewayHarness()
  const store = harness.store()
  await store.registerStoreExtension(registration)
  return await store.extensionCall("alpha", "sql", { sql, columns: ["id"], orderBy })
}

const ids = (...values: number[]) => ({ kind: "ok" as const, value: values.map((id) => ({ id })) })

test.each([
  ["a valid column", "id", ids(1, 2, 3, 4)],
  ["mixed case", "ID DESC", ids(4, 3, 2, 1)],
  ["COLLATE NOCASE", "at COLLATE nocase, id", ids(4, 2, 1, 3)],
  ["DESC NULLS LAST", "at DESC NULLS LAST", ids(1, 2, 3, 4)],
  ["DESC NULLS FIRST", "at DESC NULLS FIRST", ids(4, 1, 2, 3)],
  ["two columns", "at, id", ids(4, 3, 2, 1)],
])("#given orderBy with %s (%p) #when reading #then rows come back in that order", async (_label, orderBy, expected) => {
  expect(await read("SELECT id, at FROM alpha_items", orderBy)).toEqual(expected)
})

test("#given a LIMIT in the statement and columns in orderBy #when reading #then the first rows come back ordered", async () => {
  expect(await read("SELECT id, at FROM alpha_items WHERE at IS NOT NULL ORDER BY at, id LIMIT 2", "at, id")).toEqual(ids(3, 2))
})

const refused = [
  "id; DROP TABLE alpha_items",
  "id--",
  "id /*x*/",
  "id) UNION SELECT 1",
  '"id"',
  "`id`",
  "[id]",
  "\u0456d",
  "id\u0000",
  "(id)",
  "1",
  "id DESC DESC",
  "id\nDROP TABLE alpha_items",
  ", id",
  "id,",
  "",
  "id COLLATE evil",
  "at LIMIT 2",
  "at LIMIT 2 OFFSET 1",
  "alpha_items.at",
  "lower(at)",
  "missing_column",
]

test.each(refused)("#given orderBy %p #when reading #then extension_schema_violation names the column-list rule", async (orderBy) => {
  const result = await read("SELECT id, at FROM alpha_items", orderBy)
  expect(result).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
  expect(result.kind === "refused" && result.message).toContain("orderBy must list the statement's output columns")
})

test("#given a well-formed orderBy column the statement does not return #when reading #then the refusal names the columns it does return", async () => {
  const result = await read("SELECT id FROM alpha_items", "at")
  expect(result).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
  expect(result.kind === "refused" && result.message).toContain('"at" is not one of them ("id")')
})

test("#given a statement reading a table the extension does not own #when ordering by a column #then the authorizer refuses before any column is looked up", async () => {
  const result = await read("SELECT delivery_id FROM deliveries", "no_such_column")
  expect(result).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
  expect(result.kind === "refused" && result.message).toContain("does not own deliveries")
})

test("#given a long orderBy #when it is refused #then the message echoes at most 80 characters of it", async () => {
  const orderBy = `id ${"x".repeat(200)}`
  const result = await read("SELECT id, at FROM alpha_items", orderBy)
  expect(result).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
  const message = result.kind === "refused" ? result.message : ""
  expect(message).toContain(`got "${orderBy.slice(0, 80)}…"`)
  expect(message).not.toContain(orderBy.slice(0, 81))
})

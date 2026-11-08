import { afterEach, expect, test } from "bun:test"

import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })
const moduleUrl = new URL("./testing/store-extension.mjs", import.meta.url).href

test.each([
  ["string literal", "INSERT INTO alpha_items (id, value) VALUES (?, 'what?')", [1], "what?"],
  ["escaped quote", "INSERT INTO alpha_items (id, value) VALUES (?, 'isn''t it?' || ?)", [1, "yes"], "isn't it?yes"],
  ["quoted identifier", 'INSERT INTO alpha_items (id, value) SELECT ?, "why?" FROM alpha_items WHERE id=0', [1], "identifier"],
  ["line comment", "INSERT INTO alpha_items (id, value) VALUES (-- ? ; '\n?, ?)", [1, "line"], "line"],
  ["block comment", "INSERT INTO alpha_items (id, value) VALUES (/* ? ; ' */?, ?)", [1, "block"], "block"],
] as const)("#given a question mark in a %s #when binding SQL #then only parameter tokens are replaced", async (_kind, sql, params, expected) => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  expect((await store.registerStoreExtension({
    name: "alpha", moduleUrl,
    migrations: [[`CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, value TEXT, "why?" TEXT DEFAULT 'identifier')`, "INSERT INTO alpha_items (id, value) VALUES (0, 'seed')"]],
  })).kind).toBe("ok")
  expect(await store.extensionCall("alpha", "sql", { sql, params })).toMatchObject({ kind: "ok" })
  expect(await store.extensionCall("alpha", "sql", { sql: "SELECT value FROM alpha_items WHERE id=1", columns: ["value"] })).toEqual({ kind: "ok", value: [{ value: expected }] })
})

test("#given a trailing SQL line comment #when reading rows #then the wrapper does not become part of the comment", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension({ name: "alpha", moduleUrl, migrations: [["CREATE TABLE alpha_items (value TEXT)", "INSERT INTO alpha_items VALUES ('kept')"]] })
  expect(await store.extensionCall("alpha", "sql", { sql: "SELECT value FROM alpha_items -- why?", columns: ["value"] })).toEqual({ kind: "ok", value: [{ value: "kept" }] })
})

import { afterEach, expect, test } from "bun:test"

import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})
const moduleUrl = new URL("./testing/extension-lifecycle.mjs", import.meta.url).href
const descriptor = {
  name: "alpha",
  moduleUrl,
  migrations: [["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, value TEXT)"]],
}

test("#given a current extension #when it is called #then the call takes the write lock once", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(descriptor)
  await store.extensionCall("alpha", "put", { name: "alpha", id: 1, value: "warm" })
  const before = (await store.stats()).transactions
  expect(await store.extensionCall("alpha", "put", { name: "alpha", id: 2, value: "kept" })).toEqual({
    kind: "ok",
    value: { value: "kept" },
  })
  expect((await store.stats()).transactions - before).toBe(1)
})

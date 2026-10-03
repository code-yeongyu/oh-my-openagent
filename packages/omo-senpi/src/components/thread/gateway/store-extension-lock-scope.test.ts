import { afterEach, expect, test } from "bun:test"

import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })
const moduleUrl = new URL("./testing/extension-lifecycle.mjs", import.meta.url).href
const descriptor = { name: "alpha", moduleUrl, migrations: [["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, value TEXT)"]] }
const binding = { principal: "fixture", binding: { platform: "custom", account_id: "bot", chat_id: "chat", session_durable_id: "target", ttl_seconds: null } }

test("#given a current extension #when it is called #then the call takes the write lock once", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(descriptor)
  await store.extensionCall("alpha", "put", { name: "alpha", id: 1, value: "warm" })
  const before = (await store.stats()).transactions
  expect(await store.extensionCall("alpha", "put", { name: "alpha", id: 2, value: "kept" })).toEqual({ kind: "ok", value: { value: "kept" } })
  expect((await store.stats()).transactions - before).toBe(1)
})

test("#given a statement run while an enqueue is still in flight #when the operation finishes #then the call fails and neither write commits", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(descriptor)
  const bound = await store.extensionCall<{ kind: "ok"; binding: { binding_id: string } }>("alpha", "core", { op: "bind", request: binding })
  if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
  const result = await store.extensionCall("alpha", "execDuringEnqueue", { binding_id: bound.value.binding.binding_id, event_id: "racing", text: "hello" })
  expect(result).toMatchObject({ kind: "refused", code: "extension_operation_failed" })
  expect(await store.extensionCall("alpha", "rows", { name: "alpha" })).toEqual({ kind: "ok", value: [] })
  expect(await store.list()).toEqual([])
})

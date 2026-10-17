import { afterEach, expect, test } from "bun:test"
import type { Worker } from "node:worker_threads"

import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })
const moduleUrl = new URL("./testing/store-extension.mjs", import.meta.url).href

async function killWorker(worker: Worker): Promise<void> {
  const exited = new Promise<number>((resolve) => worker.once("exit", resolve))
  await worker.terminate()
  await exited
}

test("#given a registered extension #when the store worker exits #then the reopened store still serves its calls", async () => {
  const h = (harness = createGatewayHarness())
  const workers: Worker[] = []
  const store = h.store({ _test: { onWorkerStarted: (worker) => workers.push(worker) } })
  expect(await store.registerStoreExtension({ name: "alpha", moduleUrl, migrations: [["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, value TEXT)"]] })).toEqual({ kind: "ok", value: { version: 1 } })
  expect(await store.extensionCall("alpha", "put", { name: "alpha", id: 1, value: "before" })).toEqual({ kind: "ok", value: { value: "before" } })
  await killWorker(workers[0] as Worker)
  expect(await store.extensionCall("alpha", "put", { name: "alpha", id: 2, value: "after" })).toEqual({ kind: "ok", value: { value: "after" } })
  expect(await store.extensionCall("alpha", "rows", { name: "alpha" })).toEqual({ kind: "ok", value: [{ id: 1, value: "before" }, { id: 2, value: "after" }] })
  expect(workers.length).toBe(2)
})

test("#given a reserved name and a refused downgrade #when the store worker exits #then the reopened store keeps exactly the registrations the first worker held", async () => {
  const h = (harness = createGatewayHarness())
  const workers: Worker[] = []
  const store = h.store({ _test: { onWorkerStarted: (worker) => workers.push(worker) } })
  const v2 = { name: "alpha", moduleUrl, migrations: [["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, value TEXT)"], ["ALTER TABLE alpha_items ADD COLUMN note TEXT"]] }
  expect(await store.registerStoreExtension(v2)).toEqual({ kind: "ok", value: { version: 2 } })
  expect(await store.registerStoreExtension({ ...v2, migrations: v2.migrations.slice(0, 1) })).toMatchObject({ kind: "refused", code: "gateway_schema_too_new" })
  expect(await store.registerStoreExtension({ name: "gateway", moduleUrl, migrations: [] })).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
  await killWorker(workers[0] as Worker)
  expect(await store.extensionCall("alpha", "put", { name: "alpha", id: 1, value: "v2" })).toEqual({ kind: "ok", value: { value: "v2" } })
  expect(await store.extensionCall("gateway", "rows", { name: "gateway" })).toMatchObject({ kind: "refused", code: "extension_unknown_name" })
})

import { afterEach, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { createGatewayRelay } from "./relay"
import { gatewayDatabasePath } from "./paths"
import type { GatewayStore } from "./store"
import type { SessionCallableOp, StoreExtensionRegistration } from "./store-extensions"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })

const moduleUrl = new URL("./testing/session-callable-extension.mjs", import.meta.url).href
const migrations = [[
  "CREATE TABLE gw_opens (id INTEGER PRIMARY KEY, args TEXT NOT NULL)",
  "CREATE TABLE gw_requests (id TEXT PRIMARY KEY, status TEXT NOT NULL)",
  "CREATE TABLE gw_items (binding_id TEXT PRIMARY KEY, status TEXT NOT NULL)",
  "CREATE TABLE gw_leads (item TEXT PRIMARY KEY, lead TEXT NOT NULL)",
]]
const openOp: SessionCallableOp = {
  op: "openThread",
  toolName: "open",
  description: "Open a chat thread for a session.",
  parameters: { type: "object", additionalProperties: false, required: ["target_session_durable_id"], properties: { target_session_durable_id: { type: "string" }, await: { type: "boolean" }, await_request_id: { type: "string" } } },
  targetArg: "target_session_durable_id",
  await: { statusOp: "threadOpenStatus", expireOp: "expireThreadOpen", timeoutMs: 2_000 },
  wake: "requests.marker",
}
const statusOp: SessionCallableOp = {
  op: "workItemStatus",
  toolName: "work_item_status",
  description: "Report the status of the caller's own work item.",
  parameters: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["working", "waiting", "done", "failed"] }, note: { type: "string", maxLength: 500 }, work_item_id: { type: "string" } } },
  wake: "requests.marker",
}
const registration = (overrides: Partial<StoreExtensionRegistration> = {}): StoreExtensionRegistration => ({
  name: "gw", moduleUrl, migrations, wakeDir: "thread-open", sessionCallable: [openOp, statusOp], ...overrides,
})
const bindTo = (store: GatewayStore, h: GatewayHarness, session: string, chat: string) =>
  createGatewayRelay({ store, engine: h.engineFor(store), endpoints: { wake: async () => ({ admitted: [] }) }, locate: async () => null, now: () => h.clock.now })
    .bind({ principal: `session:${session}`, binding: { platform: "custom", account_id: "qa", chat_id: chat, thread_id: "t1", session_durable_id: session } })

test("#given a session bound with the core bind #when an op reads bindingsForSession in its transaction #then that binding is returned; another session gets none", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration())
  expect(await bindTo(store, h, "bound", "chat-a")).toMatchObject({ kind: "ok" })
  const bound = await store.extensionSessionAwait("gw", "workItemStatus", { status: "working" }, { callerDurableId: "bound" })
  expect(bound).toMatchObject({ kind: "ok", value: { updated: true } })
  expect(await store.extensionSessionAwait("gw", "workItemStatus", { status: "working" }, { callerDurableId: "loose" })).toMatchObject({ kind: "ok", value: { updated: false, reason: "no_binding" } })
})

test("#given a binding that expired #when bindingsForSession runs #then it is not returned", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration())
  await bindTo(store, h, "bound", "chat-a")
  h.clock.now += 400 * 24 * 60 * 60 * 1000
  expect(await store.extensionSessionAwait("gw", "workItemStatus", { status: "working" }, { callerDurableId: "bound" })).toMatchObject({ kind: "ok", value: { updated: false, reason: "no_binding" } })
})

test("#given a worker bound to item A #when it names item B whose lead is another session #then the op refuses it, because the caller it sees is the engine's and cannot be the lead's", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration())
  await bindTo(store, h, "worker-a", "chat-a")
  await store.extensionCall("gw", "sql", { sql: "INSERT INTO gw_leads (item, lead) VALUES ('item-b', 'lead-b')" })
  const named = await store.extensionSessionAwait("gw", "workItemStatus", { status: "done", work_item_id: "item-b" }, { callerDurableId: "worker-a" })
  expect(named).toMatchObject({ kind: "ok", value: { updated: false, reason: "not_item_lead" } })
  const asLead = await store.extensionSessionAwait("gw", "workItemStatus", { status: "done", work_item_id: "item-b", caller_session_durable_id: "lead-b" }, { callerDurableId: "worker-a" })
  expect(asLead).toMatchObject({ kind: "refused", code: "invalid_arguments" })
  const own = await store.extensionSessionAwait("gw", "workItemStatus", { status: "done" }, { callerDurableId: "worker-a" })
  expect(own).toMatchObject({ kind: "ok", value: { updated: true } })
  expect((own as { value: { binding_id: string } }).value.binding_id).not.toBe("item-b")
})

test("#given the item's lead #when it names that item #then the op accepts it", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration())
  await store.extensionCall("gw", "sql", { sql: "INSERT INTO gw_leads (item, lead) VALUES ('item-b', 'lead-b')" })
  expect(await store.extensionSessionAwait("gw", "workItemStatus", { status: "failed", work_item_id: "item-b" }, { callerDurableId: "lead-b" })).toMatchObject({ kind: "ok", value: { updated: true, binding_id: "item-b" } })
})

test("#given a declared wake file #when a session call commits #then the marker is touched after the commit; a refused call and a rolled-back call do not touch it", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration({ sessionCallable: [openOp, { ...statusOp, op: "failAfterWrite", toolName: "fail", wake: "requests.marker" }] }))
  const marker = join(dirname(gatewayDatabasePath(h.agentDir)), "thread-open", "requests.marker")
  mkdirSync(dirname(marker), { recursive: true })
  expect(await store.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child", nope: 1 }, { callerDurableId: "caller" })).toMatchObject({ kind: "refused" })
  expect(existsSync(marker)).toBe(false)
  expect(await store.extensionSessionAwait("gw", "failAfterWrite", { status: "working" }, { callerDurableId: "caller" })).toMatchObject({ kind: "refused" })
  expect(existsSync(marker)).toBe(false)
  expect(await store.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child" }, { callerDurableId: "caller" })).toMatchObject({ kind: "ok" })
  expect(statSync(marker).isFile()).toBe(true)
})

test("#given a session call that commits and then stops at the afterDbCommit seam #when the store is read #then the row is committed and the wake file is untouched, so the touch can only follow the commit", async () => {
  const h = (harness = createGatewayHarness())
  await h.store().registerStoreExtension(registration())
  const marker = join(dirname(gatewayDatabasePath(h.agentDir)), "thread-open", "requests.marker")
  mkdirSync(dirname(marker), { recursive: true })
  const stopping = h.store({ _test: { afterDbCommit: "throw" } })
  await stopping.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child" }, { callerDurableId: "caller" }).catch(() => undefined)
  const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
  try { expect(db.query("SELECT COUNT(*) AS n FROM gw_opens").get()).toEqual({ n: 1 }) } finally { db.close() }
  expect(existsSync(marker)).toBe(false)
})

test.each(["tor_short", "../../escape", "tor_" + "G".repeat(32)])("#given an await_request_id %p #when the tool would wait on it #then it is refused before any path is built", async (awaitId) => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration())
  expect(await store.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child", await: true, await_request_id: awaitId }, { callerDurableId: "caller" })).toMatchObject({ kind: "refused", code: "invalid_arguments" })
})

test("#given the connector completes before the wait is armed #when the tool awaits #then it returns the final status at once, without waiting for the timeout", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration({ sessionCallable: [{ ...openOp, await: { ...openOp.await!, timeoutMs: 120_000 } }] }))
  const id = "tor_" + "1".repeat(32)
  await store.extensionCall("gw", "completeThreadOpen", { await_request_id: id })
  const result = await store.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child", await: true, await_request_id: id }, { callerDurableId: "caller" })
  expect(result).toMatchObject({ kind: "ok", value: { status: "opened" } })
})

test("#given a waiter that read pending and armed its watch #when a SEPARATE store completes the open and touches the wake file #then the watch wakes the waiter, which returns opened long before its 120 s timeout", async () => {
  const h = (harness = createGatewayHarness())
  const armedIds: string[] = []
  let armed: () => void = () => undefined
  const waiterArmed = new Promise<void>((resolve) => { armed = resolve })
  // The hook fires only after the first status read answered pending, so the completion below lands after it.
  const store = h.store({ _test: { onAwaitArmed: (id) => { armedIds.push(id); armed() } } })
  await store.registerStoreExtension(registration({ sessionCallable: [{ ...openOp, await: { ...openOp.await!, timeoutMs: 120_000 } }] }))
  const id = "tor_" + "2".repeat(32)
  const wake = join(dirname(gatewayDatabasePath(h.agentDir)), "thread-open", id)
  mkdirSync(dirname(wake), { recursive: true })
  const waiting = store.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child", await: true, await_request_id: id }, { callerDurableId: "caller" })
  await waiterArmed
  const connector = h.store()
  expect(await connector.extensionCall("gw", "completeThreadOpen", { await_request_id: id })).toMatchObject({ kind: "ok" })
  writeFileSync(wake, "")
  expect(await waiting).toMatchObject({ kind: "ok", value: { status: "opened" } })
  expect(armedIds).toEqual([id])
}, 15_000)

test("#given a running connector (wake dir present) but no wake ever arrives #when timeoutMs passes #then expireOp runs and the final status is returned", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration({ sessionCallable: [{ ...openOp, await: { ...openOp.await!, timeoutMs: 50 } }] }))
  mkdirSync(join(dirname(gatewayDatabasePath(h.agentDir)), "thread-open"), { recursive: true })
  const id = "tor_" + "3".repeat(32)
  const result = await store.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child", await: true, await_request_id: id }, { callerDurableId: "caller" })
  expect(result).toMatchObject({ kind: "ok", value: { status: "refused" } })
})

test("#given no connector has started (no wake dir) #when the tool awaits with a long timeout #then it expires at once instead of waiting it out", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration({ sessionCallable: [{ ...openOp, await: { ...openOp.await!, timeoutMs: 120_000 } }] }))
  const id = "tor_" + "4".repeat(32)
  const result = await store.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child", await: true, await_request_id: id }, { callerDurableId: "caller" })
  expect(result).toMatchObject({ kind: "ok", value: { status: "refused" } })
})

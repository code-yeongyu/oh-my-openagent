import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Worker } from "node:worker_threads"

import { gatewayDatabasePath } from "./paths"
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

test.each<[string, Partial<SessionCallableOp>]>([
  ["an op the module does not export", { op: "missingOp" }],
  ["a toolName past the 41-character short-name bound", { toolName: "t".repeat(42) }],
  ["a one-character toolName", { toolName: "x" }],
  ["a toolName with uppercase", { toolName: "GwOpen" }],
  ["parameters without additionalProperties:false", { parameters: { type: "object", properties: { target_session_durable_id: { type: "string" } } } }],
  ["a targetArg absent from parameters", { targetArg: "session" }],
  ["a timeoutMs out of range", { await: { statusOp: "threadOpenStatus", expireOp: "expireThreadOpen", timeoutMs: 0 } }],
  ["an await statusOp the module does not export", { await: { statusOp: "nope", expireOp: "expireThreadOpen", timeoutMs: 2_000 } }],
  ["a wake name with a slash", { wake: "../escape" }],
])("#given a declaration with %s #when registering #then it is refused and nothing is persisted", async (_label, broken) => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  expect(await store.registerStoreExtension(registration({ sessionCallable: [{ ...openOp, ...broken }] }))).toMatchObject({ kind: "refused" })
  expect(await store.sessionCallableOps()).toEqual([])
})

// Contract: an internal op registers no tool, so it can never carry the tool-only fields a tool would act on.
test.each<[string, Readonly<Record<string, unknown>>]>([
  ["a toolName", { toolName: "status" }],
  ["an await", { await: { statusOp: "threadOpenStatus", expireOp: "expireThreadOpen", timeoutMs: 2_000 } }],
  ["a wake", { wake: "requests.marker" }],
  ["internal set to false", { internal: false }],
])("#given an internal declaration with %s #when registering #then it is refused and nothing is persisted", async (_label, extra) => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  const internal: SessionCallableOp = { op: "workItemStatus", internal: true, parameters: statusOp.parameters }
  expect(await store.registerStoreExtension(registration({ sessionCallable: [{ ...internal, ...extra } as unknown as SessionCallableOp] }))).toMatchObject({ kind: "refused" })
  expect(await store.extensionCall("gw", "workItemStatus", { status: "working" })).toMatchObject({ kind: "refused", code: "extension_unknown_name" })
  expect(await store.registerStoreExtension(registration({ sessionCallable: [internal] }))).toMatchObject({ kind: "ok" })
})

test("#given declared parameters whose schema only fails when a value reaches it (an invalid pattern) #when a session call carries that field #then it is refused invalid_arguments, never a thrown tool error", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  const broken = { ...statusOp, parameters: { ...statusOp.parameters, properties: { status: { type: "string", pattern: "(" } } } }
  expect(await store.registerStoreExtension(registration({ sessionCallable: [broken] }))).toMatchObject({ kind: "ok" })
  expect(await store.extensionSessionAwait("gw", "workItemStatus", { status: "working" }, { callerDurableId: "caller" })).toMatchObject({ kind: "refused", code: "invalid_arguments" })
})

test("#given two entries that declare the same op #when registering #then it is refused, because the worker resolves a session call by op and the second entry's schema, targetArg and await would never apply", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  expect(await store.registerStoreExtension(registration({ sessionCallable: [openOp, { ...statusOp, op: openOp.op }] }))).toMatchObject({ kind: "refused", code: "invalid_arguments" })
  expect(await store.sessionCallableOps()).toEqual([])
})

test.each(["../escape", "Thread-Open", ""])("#given wakeDir %p #when registering #then it is refused", async (wakeDir) => {
  const h = (harness = createGatewayHarness())
  expect(await h.store().registerStoreExtension(registration({ wakeDir }))).toMatchObject({ kind: "refused" })
})

test("#given the gateway's registration (omo_gateway: thread_open, work_item_status) #when another process lists session ops #then the tools are exactly ext_omo_gateway_thread_open and ext_omo_gateway_work_item_status", async () => {
  const h = (harness = createGatewayHarness())
  const gateway = registration({ name: "omo_gateway", migrations: [], sessionCallable: [{ ...openOp, toolName: "thread_open" }, { ...statusOp, toolName: "work_item_status" }] })
  expect(await h.store().registerStoreExtension(gateway)).toMatchObject({ kind: "ok" })
  expect((await h.store().sessionCallableOps()).map((entry) => entry.registeredName)).toEqual(["ext_omo_gateway_thread_open", "ext_omo_gateway_work_item_status"])
})

test("#given a toolName whose composed ext_<extension>_<toolName> passes 64 characters #when registering #then it is refused and nothing is persisted", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  expect(await store.registerStoreExtension(registration({ name: "x".repeat(32), migrations: [], sessionCallable: [{ ...statusOp, toolName: "t".repeat(30) }] }))).toMatchObject({ kind: "refused", code: "invalid_arguments" })
  expect(await store.sessionCallableOps()).toEqual([])
})

test("#given two extensions whose composed tool names are equal (ab + cc_dd, ab_cc + dd) #when the second registers #then it is refused and the first keeps the name", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  expect(await store.registerStoreExtension(registration({ name: "ab", migrations: [], sessionCallable: [{ ...statusOp, toolName: "cc_dd" }] }))).toMatchObject({ kind: "ok" })
  expect(await store.registerStoreExtension(registration({ name: "ab_cc", migrations: [["CREATE TABLE ab_cc_rows (id INTEGER PRIMARY KEY)"]], sessionCallable: [{ ...statusOp, toolName: "dd" }] }))).toMatchObject({ kind: "refused", code: "invalid_arguments" })
  expect((await h.store().sessionCallableOps()).map((entry) => [entry.extension, entry.registeredName])).toEqual([["ab", "ext_ab_cc_dd"]])
  // Refused before its migrations ran: the schema is untouched.
  const db = new (await import("bun:sqlite")).Database(gatewayDatabasePath(h.agentDir), { readonly: true })
  try { expect(db.query("SELECT name FROM sqlite_schema WHERE name = 'ab_cc_rows'").all()).toEqual([]) } finally { db.close() }
})

test("#given two declared ops #when another process lists session ops #then it sees exactly both, and each is refused on the public channel", async () => {
  const h = (harness = createGatewayHarness())
  await h.store().registerStoreExtension(registration())
  const other = h.store()
  const ops = await other.sessionCallableOps()
  expect(ops.map((entry) => entry.registeredName).sort()).toEqual(["ext_gw_open", "ext_gw_work_item_status"])
  for (const op of ["openThread", "workItemStatus"]) expect(await other.extensionCall("gw", op, {})).toMatchObject({ kind: "refused", code: "caller_not_allowed" })
})

test("#given a declaration persisted by one process #when a second process calls the op through the session channel #then its worker imports the module and runs it", async () => {
  const h = (harness = createGatewayHarness())
  await h.store().registerStoreExtension(registration())
  const second = h.store()
  const result = await second.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child" }, { callerDurableId: "caller" })
  expect(result).toMatchObject({ kind: "ok", value: { opened: true } })
})

test("#given an extension registered only by another process #when this process makes a PUBLIC extensionCall to one of its ordinary ops #then its worker imports the module from the persisted row and runs the op", async () => {
  const h = (harness = createGatewayHarness())
  await h.store().registerStoreExtension(registration())
  const connector = h.store()
  const id = "tor_" + "9".repeat(32)
  expect(await connector.extensionCall("gw", "completeThreadOpen", { await_request_id: id })).toMatchObject({ kind: "ok", value: { completed: true } })
  expect(await connector.extensionCall("gw", "openThread", { target_session_durable_id: "child" })).toMatchObject({ kind: "refused", code: "caller_not_allowed" })
})

test("#given a persisted moduleUrl that no longer exists #when a session lists ops and then calls one #then listing works without importing, and the call alone answers extension_import_failed", async () => {
  const h = (harness = createGatewayHarness())
  const gone = join(h.agentDir, "gone-extension.mjs")
  writeFileSync(gone, (await Bun.file(new URL(moduleUrl)).text()))
  await h.store().registerStoreExtension(registration({ moduleUrl: `file://${gone}` }))
  Bun.spawnSync(["rm", "-f", gone])
  const session = h.store()
  expect((await session.sessionCallableOps()).map((entry) => entry.registeredName).sort()).toEqual(["ext_gw_open", "ext_gw_work_item_status"])
  expect(await session.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child" }, { callerDurableId: "caller" })).toMatchObject({ kind: "refused", code: "extension_import_failed" })
  writeFileSync(gone, (await Bun.file(new URL(moduleUrl)).text()))
  expect(await session.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child" }, { callerDurableId: "caller" })).toMatchObject({ kind: "ok" })
})

test("#given a persisted moduleUrl that is not a file .js/.mjs/.cjs URL #when the session channel would load it #then it is refused", async () => {
  const h = (harness = createGatewayHarness())
  await h.store().registerStoreExtension(registration())
  const db = new (await import("bun:sqlite")).Database(gatewayDatabasePath(h.agentDir))
  try { db.query("UPDATE extension_registrations SET descriptor_json = json_set(descriptor_json, '$.moduleUrl', 'https://example.invalid/x.mjs') WHERE name = 'gw'").run() } finally { db.close() }
  expect(await h.store().extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child" }, { callerDurableId: "caller" })).toMatchObject({ kind: "refused", code: "extension_import_failed" })
})

test("#given the same extension registered again from a second location #when listing #then exactly one descriptor exists and the new module is called", async () => {
  const h = (harness = createGatewayHarness())
  const relocated = join(h.agentDir, "relocated", "session-callable-extension.mjs")
  mkdirSync(dirname(relocated), { recursive: true })
  writeFileSync(relocated, (await Bun.file(new URL(moduleUrl)).text()).replace("opened: true", "opened: true, relocated: true"))
  await h.store().registerStoreExtension(registration())
  await h.store().registerStoreExtension(registration({ moduleUrl: `file://${relocated}` }))
  const later = h.store()
  expect(await later.sessionCallableOps()).toHaveLength(2)
  expect(await later.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child" }, { callerDurableId: "caller" })).toMatchObject({ kind: "ok", value: { relocated: true } })
})

test("#given process A registered gw from one location and process B later from another #when A's store worker restarts and restores A's registration #then the persisted descriptor stays B's newer one", async () => {
  const h = (harness = createGatewayHarness())
  const relocated = join(h.agentDir, "relocated", "session-callable-extension.mjs")
  mkdirSync(dirname(relocated), { recursive: true })
  writeFileSync(relocated, (await Bun.file(new URL(moduleUrl)).text()).replace("opened: true", "opened: true, relocated: true"))
  let workerA: Worker | undefined
  const a = h.store({ _test: { onWorkerStarted: (worker) => { workerA = worker } } })
  expect(await a.registerStoreExtension(registration())).toMatchObject({ kind: "ok" })
  h.clock.now += 60_000
  expect(await h.store().registerStoreExtension(registration({ moduleUrl: `file://${relocated}` }))).toMatchObject({ kind: "ok" })
  const crashed = workerA!
  const exited = new Promise<void>((resolve) => crashed.once("exit", () => resolve()))
  await crashed.terminate()
  await exited
  h.clock.now += 60_000
  // A's next call starts a fresh worker, which restores A's older registration before running it.
  expect(await a.extensionCall("gw", "completeThreadOpen", { await_request_id: "tor_" + "6".repeat(32) })).toMatchObject({ kind: "ok" })
  expect(workerA).not.toBe(crashed)
  expect(await h.store().extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child" }, { callerDurableId: "caller" })).toMatchObject({ kind: "ok", value: { relocated: true } })
})

test("#given no gateway store file #when a session lists ops (session_start) #then the answer is empty and no store is opened or created", async () => {
  const h = (harness = createGatewayHarness())
  expect(await h.store().sessionCallableOps()).toEqual([])
  expect(existsSync(gatewayDatabasePath(h.agentDir))).toBe(false)
})

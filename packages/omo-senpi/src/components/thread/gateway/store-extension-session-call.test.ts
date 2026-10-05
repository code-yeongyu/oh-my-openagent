import { afterEach, expect, test } from "bun:test"

import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import type { StoreExtensionRegistration } from "./store-extensions"
import { UNKNOWN_CALLER } from "../tools/ports"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })

const moduleUrl = new URL("./testing/session-callable-extension.mjs", import.meta.url).href
const migrations = [[
  "CREATE TABLE gw_opens (id INTEGER PRIMARY KEY, args TEXT NOT NULL)",
  "CREATE TABLE gw_requests (id TEXT PRIMARY KEY, status TEXT NOT NULL)",
  "CREATE TABLE gw_items (binding_id TEXT PRIMARY KEY, status TEXT NOT NULL)",
]]
const parameters = {
  type: "object",
  additionalProperties: false,
  required: ["target_session_durable_id"],
  properties: { target_session_durable_id: { type: "string", minLength: 1 }, title: { type: "string" }, await: { type: "boolean" }, await_request_id: { type: "string" } },
}
const registration = (overrides: Partial<StoreExtensionRegistration> = {}): StoreExtensionRegistration => ({
  name: "gw",
  moduleUrl,
  migrations,
  wakeDir: "thread-open",
  sessionCallable: [{
    op: "openThread",
    toolName: "open",
    description: "Open a chat thread for a session.",
    parameters,
    targetArg: "target_session_durable_id",
    await: { statusOp: "threadOpenStatus", expireOp: "expireThreadOpen", timeoutMs: 2_000 },
    wake: "requests.marker",
  }],
  ...overrides,
})

const opened = (result: unknown) => (result as { kind: string; value: { received: Record<string, unknown> } }).value.received

const internalRegistration = () => registration({ sessionCallable: [{ op: "openThread", internal: true, parameters, targetArg: "target_session_durable_id" }] })

// Security contract: an internal op takes a session id the model must not be able to forge, so the public channel never reaches it.
test("#given an internal session op #when the public extensionCall names it with a forged caller #then it is refused caller_not_allowed and the op never runs", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  expect(await store.registerStoreExtension(internalRegistration())).toMatchObject({ kind: "ok" })
  const forged = await store.extensionCall("gw", "openThread", { target_session_durable_id: "victim", caller_session_durable_id: "lead-session" })
  expect(forged).toMatchObject({ kind: "refused", code: "caller_not_allowed" })
  // openThread records every call it receives; deleting the records counts them.
  expect(await store.extensionCall("gw", "sql", { sql: "DELETE FROM gw_opens" })).toEqual({ kind: "ok", value: 0 })
})

test("#given an internal session op #when the session's own component calls it through extensionSessionAwait #then it runs with the engine caller stamped and the forged one refused", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  expect(await store.registerStoreExtension(internalRegistration())).toMatchObject({ kind: "ok" })
  const result = await store.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child" }, { callerDurableId: "caller" })
  expect(result).toMatchObject({ kind: "ok" })
  expect(opened(result)).toMatchObject({ target_session_durable_id: "child", caller_session_durable_id: "caller" })
  const forged = await store.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child", caller_session_durable_id: "lead-session" }, { callerDurableId: "caller" })
  expect(forged).toMatchObject({ kind: "refused", code: "invalid_arguments" })
  expect(await store.extensionCall("gw", "sql", { sql: "DELETE FROM gw_opens" })).toEqual({ kind: "ok", value: 1 })
})

test("#given a session-callable op #when the public extensionCall names it #then it is refused caller_not_allowed (O7: a forged caller never reaches the op)", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  expect(await store.registerStoreExtension(registration())).toMatchObject({ kind: "ok" })
  for (const op of ["openThread", "threadOpenStatus", "expireThreadOpen"]) {
    const forged = await store.extensionCall("gw", op, { target_session_durable_id: "victim", caller_session_durable_id: "lead-session", caller_created_target: true })
    expect(forged).toMatchObject({ kind: "refused", code: "caller_not_allowed" })
  }
  expect(await store.extensionCall("gw", "completeThreadOpen", { await_request_id: "tor_" + "a".repeat(32) })).toMatchObject({ kind: "ok" })
})

test.each([
  ["caller_session_durable_id", { caller_session_durable_id: "lead-session" }],
  ["caller_created_target true", { caller_created_target: true }],
  ["caller_created_target false", { caller_created_target: false }],
])("#given args already carrying %s #when the session channel is called #then it is refused before the op runs", async (_label, forged) => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration())
  const result = await store.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child", ...forged }, { callerDurableId: "caller" })
  expect(result).toMatchObject({ kind: "refused", code: "invalid_arguments" })
  expect(await store.extensionCall("gw", "completeThreadOpen", { await_request_id: "tor_" + "b".repeat(32) })).toMatchObject({ kind: "ok" })
})

test("#given an env var naming another caller #when the session channel is called #then the stamp is the engine caller, never the environment", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration())
  const previous = process.env.OMO_GATEWAY_CALLER_SESSION
  process.env.OMO_GATEWAY_CALLER_SESSION = "lead-session"
  try {
    const result = await store.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child" }, { callerDurableId: "caller" })
    expect(opened(result).caller_session_durable_id).toBe("caller")
  } finally {
    if (previous === undefined) delete process.env.OMO_GATEWAY_CALLER_SESSION
    else process.env.OMO_GATEWAY_CALLER_SESSION = previous
  }
})

test("#given no engine caller #when the session channel is called #then it is refused caller_context_missing", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration())
  for (const callerDurableId of ["", UNKNOWN_CALLER]) {
    expect(await store.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child" }, { callerDurableId })).toMatchObject({ kind: "refused", code: "caller_context_missing" })
  }
})

test("#given an op the extension did not declare session-callable #when the session channel names it #then it is refused", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration())
  expect(await store.extensionSessionAwait("gw", "completeThreadOpen", { await_request_id: "tor_" + "c".repeat(32) }, { callerDurableId: "caller" })).toMatchObject({ kind: "refused", code: "extension_unknown_op" })
})

test("#given a child the caller created with thread_create #when the caller opens a thread for it #then caller_created_target is stamped true", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration())
  await store.recordThreadCreation({ creator_durable_id: "caller", created_durable_id: "child" })
  const result = await store.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child" }, { callerDurableId: "caller" })
  expect(opened(result)).toMatchObject({ caller_session_durable_id: "caller", caller_created_target: true })
})

test.each([
  ["a child of another session", "other-parent"],
  ["a session nobody thread_create'd (an operator TUI)", undefined],
])("#given %s #when the caller opens a thread for it #then caller_created_target is omitted, never false", async (_label, creator) => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.registerStoreExtension(registration())
  if (creator !== undefined) await store.recordThreadCreation({ creator_durable_id: creator, created_durable_id: "target" })
  const result = await store.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "target" }, { callerDurableId: "caller" })
  expect(opened(result).caller_session_durable_id).toBe("caller")
  expect(Object.hasOwn(opened(result), "caller_created_target")).toBe(false)
})

test("#given a recorded creation #when the store reopens (host restart) #then the creator is still recognised", async () => {
  const h = (harness = createGatewayHarness())
  const first = h.store()
  await first.registerStoreExtension(registration())
  await first.recordThreadCreation({ creator_durable_id: "caller", created_durable_id: "child" })
  await first.dispose()
  const second = h.store()
  const result = await second.extensionSessionAwait("gw", "openThread", { target_session_durable_id: "child" }, { callerDurableId: "caller" })
  expect(opened(result).caller_created_target).toBe(true)
})

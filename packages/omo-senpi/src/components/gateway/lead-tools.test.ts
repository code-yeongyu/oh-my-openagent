import { afterEach, expect, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createGatewayComponent } from "./index"
import { createGatewayScopeAccess } from "./scope-access"
import { scopeFixture, type ScopeFixture } from "./scope-memory.test-support"

let fixture: ScopeFixture | undefined
const logger = { info() {}, warn() {}, error() {} }
const lead = { session_durable_id: "lead", role: "lead" } as const
const worker = { session_durable_id: "worker", role: "worker" } as const

afterEach(async () => { await fixture?.dispose(); fixture = undefined })

async function toolCall(f: ScopeFixture, session: string, toolName: string, input: unknown = {}) {
  const results = await f.pi.dispatch("tool_call", { type: "tool_call", toolCallId: "call", toolName, input }, f.context(session))
  return results.find((result) => result !== null && typeof result === "object" && Reflect.get(result, "block") === true)
}

async function leadFixture() {
  const f = fixture = await scopeFixture()
  await f.members("A", null, [lead, worker])
  // Each scenario starts with an enforced lead: pass-through must not be an absent guard.
  expect(await toolCall(f, "lead", "bash")).toMatchObject({ block: true })
  return f
}

for (const toolName of ["bash", "edit", "write", "eval"]) {
  test(`#given a scope lead #when calling ${toolName} #then it is refused with scope and tool in the reason`, async () => {
    const f = await leadFixture()
    const result = await toolCall(f, "lead", toolName)
    expect(result).toMatchObject({ block: true })
    const reason: unknown = result !== null && typeof result === "object" ? Reflect.get(result, "reason") : undefined
    expect(typeof reason).toBe("string")
    if (typeof reason !== "string") throw new Error("missing tool refusal reason")
    expect(reason).toContain("A")
    expect(reason).toContain(toolName)
    expect(reason.split("\n")).toHaveLength(1)
  })
}

for (const toolName of ["read", "grep", "find", "ls", "glob", "thread_create", "thread_bind", "thread_send", "thread_report", "ext_omo_gateway_thread_open", "ext_omo_gateway_work_item_status", "ext_omo_gateway_chat_read", "memory", "memory_apply_patch", "gateway_learning"]) {
  test(`#given an enforced scope lead #when calling ${toolName} #then the tool passes through`, async () => {
    const f = await leadFixture()
    expect(await toolCall(f, "lead", toolName)).toBeUndefined()
  })
}

for (const toolName of ["unknown_tool", "thread_unknown", "memory_unknown", "ext_other_thread_open", "ext_omo_gateway_", "plugin_read", "task", "computer"]) {
  test(`#given a scope lead #when calling unlisted ${toolName} #then the allowlist refuses it`, async () => {
    const f = await leadFixture()
    expect(await toolCall(f, "lead", toolName)).toMatchObject({ block: true })
  })
}

for (const session of ["worker", "unbound"]) {
  test(`#given an enforced lead and ${session} session #when the latter calls execution tools #then it is unchanged`, async () => {
    const f = await leadFixture()
    for (const toolName of ["bash", "edit", "write", "eval", "unknown_tool"]) {
      expect(await toolCall(f, session, toolName)).toBeUndefined()
    }
  })
}

test("#given an enforced lead and no gateway store #when calling bash #then the storeless component passes through", async () => {
  await leadFixture()
  const pi = new FakeExtensionAPI()
  createGatewayComponent({ loadGatewaySection: () => undefined }).register(pi, { logger, config: { getFlag: () => undefined } })
  const results = await pi.dispatch("tool_call", { type: "tool_call", toolName: "bash", input: {} }, { sessionManager: { getSessionId: () => "lead" } })
  expect(results.every((result) => result === undefined)).toBe(true)
})

for (const role of ["demoted", "released"]) {
  test(`#given an enforced lead #when ${role} by a membership push #then bash passes through on its next call`, async () => {
    const f = await leadFixture()
    await f.members("A", null, role === "demoted" ? [{ ...lead, role: "worker" }, worker] : [worker])
    expect(await toolCall(f, "lead", "bash")).toBeUndefined()
  })
}

test("#given an enforced lead #when tool args forge a worker identity #then the engine caller still determines refusal", async () => {
  const f = await leadFixture()
  expect(await toolCall(f, "lead", "bash", { session_id: "worker", session_durable_id: "worker", role: "worker" })).toMatchObject({ block: true })
  expect(await toolCall(f, "worker", "bash", { session_id: "lead" })).toBeUndefined()
})

/** The component over the real store, whose membership lookups start failing on `fail()`, as in a store outage. */
async function outage(f: ScopeFixture) {
  let failing = false
  const pi = new FakeExtensionAPI()
  const warnings: string[] = []
  const access = createGatewayScopeAccess(async () => ({
    extensionCall: f.store.extensionCall.bind(f.store),
    extensionSessionAwait: (async (...args: Parameters<typeof f.store.extensionSessionAwait>) => {
      if (failing) throw new Error("lookup unavailable")
      return await f.store.extensionSessionAwait(...args)
    }) as typeof f.store.extensionSessionAwait,
  }), f.env)
  createGatewayComponent({ scopeAccess: access }).register(pi, {
    logger: { ...logger, warn: (message) => { warnings.push(message) } }, config: { getFlag: () => undefined },
  })
  const call = async (session: string, toolName: string) => {
    const results = await pi.dispatch("tool_call", { type: "tool_call", toolCallId: "call", toolName, input: {} }, f.context(session))
    return results.find((result) => result !== null && typeof result === "object" && Reflect.get(result, "block") === true)
  }
  return { call, warnings, fail: () => { failing = true } }
}

test("#given a session last seen as a scope lead #when its membership lookup fails #then bash stays refused as lead tools restricted, and an allowlisted tool still works", async () => {
  const f = await leadFixture()
  const h = await outage(f)
  expect(await h.call("lead", "bash")).toMatchObject({ block: true })
  h.fail()
  const refused = await h.call("lead", "bash")
  expect(refused).toMatchObject({ block: true, reason: expect.stringContaining("lead tools restricted: membership lookup failed") })
  expect(await h.call("lead", "read")).toBeUndefined()
  expect(h.warnings).toHaveLength(2)
})

test("#given a session never seen as a lead #when its membership lookup fails #then bash passes through with a warning", async () => {
  const f = await leadFixture()
  const h = await outage(f)
  expect(await h.call("worker", "bash")).toBeUndefined()
  h.fail()
  expect(await h.call("worker", "bash")).toBeUndefined()
  expect(await h.call("unbound", "bash")).toBeUndefined()
  expect(h.warnings).toHaveLength(2)
})

test("#given a lead released by a membership push #when its next lookup fails #then bash passes through, since its last lookup said it no longer leads", async () => {
  const f = await leadFixture()
  const h = await outage(f)
  expect(await h.call("lead", "bash")).toMatchObject({ block: true })
  await f.members("A", null, [worker])
  expect(await h.call("lead", "bash")).toBeUndefined()
  h.fail()
  expect(await h.call("lead", "bash")).toBeUndefined()
})

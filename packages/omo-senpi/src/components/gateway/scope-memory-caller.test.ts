import { afterEach, expect, test } from "bun:test"

import { GATEWAY_RULES_EXTENSION_NAME } from "./store-extension/migrations"
import { GATEWAY_RULES_SESSION_OPS } from "./store-extension/session-ops"
import { scopeFixture, type ScopeFixture } from "./scope-memory.test-support"

let fixture: ScopeFixture | undefined
afterEach(async () => { await fixture?.dispose(); fixture = undefined })

const lead = { session_durable_id: "lead", role: "lead" } as const
const worker = { session_durable_id: "worker", role: "worker" } as const

const forged: Record<string, Record<string, unknown>> = {
  learningCommitted: { session_durable_id: "lead", text: "forged", cwd: "/tmp", memory_home: "/tmp/elsewhere", now: 1 },
  digestForSession: { session_durable_id: "lead" },
  digestDelivered: { session_durable_id: "lead", scope: "A", version: 1, last_seq: 99 },
  memberForSession: { session_durable_id: "lead" },
  blockForSession: { session_durable_id: "lead" },
}

test("#given another session's id #when any session-keyed gateway_rules op is called through the public extensionCall #then it is refused caller_not_allowed and nothing changes", async () => {
  const f = fixture = await scopeFixture()
  await f.members("A", "team-A", [lead, worker])
  expect((await f.learn("worker", { text: "a real learning" })).isError).not.toBe(true)
  expect(Object.keys(forged).sort()).toEqual(GATEWAY_RULES_SESSION_OPS.map((op) => op.op).sort())
  for (const [op, args] of Object.entries(forged)) {
    expect({ op, result: await f.store.extensionCall(GATEWAY_RULES_EXTENSION_NAME, op, args) }).toMatchObject({ op, result: { kind: "refused", code: "caller_not_allowed" } })
  }
  expect((await f.repo("team-A").lsTree()).filter((path) => path.startsWith("learnings/"))).toHaveLength(1)
  expect(await f.callAs<{ entries: readonly unknown[] }>("lead", "digestForSession")).toMatchObject({ entries: [{ seq: 1 }] })
})

test("#given a session's own component #when it names another session in the args of a session op #then the store refuses the forged caller field", async () => {
  const f = fixture = await scopeFixture()
  await f.members("A", "team-A", [lead, worker])
  const forgedCaller = await f.store.extensionSessionAwait(GATEWAY_RULES_EXTENSION_NAME, "digestDelivered", { caller_session_durable_id: "lead", scope: "A", version: 1, last_seq: 99 }, { callerDurableId: "worker" })
  expect(forgedCaller.kind).toBe("refused")
  expect(await f.callAs<{ kind: string }>("worker", "digestDelivered", { scope: "A", version: 1, last_seq: 1 })).toEqual({ kind: "conflict" })
})

test("#given the gateway_learning tool #when the model passes a session id #then it is refused, and a plain call records the engine caller", async () => {
  const f = fixture = await scopeFixture()
  await f.members("A", "team-A", [lead, worker])
  const tool = f.pi.tools.find((entry) => entry.name === "gateway_learning")
  expect(Object.keys((tool?.parameters as { properties: Record<string, unknown> }).properties)).toEqual(["text"])
  expect((await f.learn("worker", { text: "smuggled", session_durable_id: "lead" })).isError).toBe(true)
  const committed = await f.learn("worker", { text: "from the worker" })
  expect(committed.isError).not.toBe(true)
  const digest = await f.callAs<{ entries: readonly { by_session: string; title: string }[] }>("lead", "digestForSession")
  expect(digest.entries.map((entry) => [entry.by_session, entry.title])).toEqual([["worker", "from the worker"]])
})

test("#given the five internal ops #when the session's tool list is built #then none of them is a model tool", async () => {
  const f = fixture = await scopeFixture()
  expect(GATEWAY_RULES_SESSION_OPS.every((op) => op.internal === true)).toBe(true)
  const declared = await f.store.sessionCallableOps()
  expect(declared.filter((op) => op.extension === GATEWAY_RULES_EXTENSION_NAME)).toEqual([])
})

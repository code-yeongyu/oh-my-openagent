import { afterEach, expect, test } from "bun:test"
import { scopeFixture, type ScopeFixture } from "./scope-memory.test-support"

let fixture: ScopeFixture | undefined
afterEach(async () => { await fixture?.dispose(); fixture = undefined })

test("#given an A snapshot before workers move to B #when the old A push arrives later #then it conflicts and cannot reclaim B members", async () => {
  const f = fixture = await scopeFixture()
  const original = [
    { session_durable_id: "source-lead", role: "lead" },
    { session_durable_id: "moving-1", role: "worker" },
    { session_durable_id: "moving-2", role: "worker" },
  ] as const
  await f.members("A", "team-A", original)
  const oldA = (await f.call<{ version: number }>("scopeMembersVersion", { scope: "A" })).version
  await f.members("B", "team-B", original.slice(1))
  const stale = await f.members("A", "team-A", original, oldA)
  expect(stale).toMatchObject({ kind: "conflict" })
  const currentA = (await f.call<{ version: number }>("scopeMembersVersion", { scope: "A" })).version
  expect(currentA).toBeGreaterThan(oldA)
  expect(await f.callAs("source-lead", "memberForSession")).toMatchObject({ scope: "A", version: currentA })
  for (const member of original.slice(1)) {
    expect(await f.callAs(member.session_durable_id, "memberForSession")).toMatchObject({ scope: "B", memory_identity: "team-B" })
  }
})
const worker = { session_durable_id: "worker", role: "worker" } as const

test("#given competing membership pushes #when both use one expected version #then the first wins and the second changes nothing", async () => {
  const f = fixture = await scopeFixture()
  expect(await f.call<{ readonly version: number }>("scopeMembersVersion", { scope: "A" })).toEqual({ version: 0 })
  expect(await f.members("A", "team-A", [worker], 0)).toEqual({ kind: "committed", version: 1 })
  expect(await f.members("A", "replacement", [], 0)).toEqual({ kind: "conflict", version: 1 })
  expect(await f.callAs("worker", "memberForSession")).toMatchObject({ memory_identity: "team-A", version: 1 })
  expect((await f.learn("worker", { text: "first push wins" })).isError).not.toBe(true)
})

test("#given membership #when an empty push clears it #then the next learning call is refused without restarting", async () => {
  const f = fixture = await scopeFixture()
  await f.members("A", "team-A", [worker])
  expect((await f.learn("worker", { text: "before removal" })).isError).not.toBe(true)
  await f.members("A", "team-A", [])
  expect((await f.learn("worker", { text: "after removal" })).isError).toBe(true)
  expect((await f.repo("team-A").lsTree()).filter((path) => path.startsWith("learnings/"))).toHaveLength(1)
  expect(await f.call<{ readonly version: number }>("scopeMembersVersion", { scope: "A" })).toEqual({ version: 2 })
})

test("#given a null memory identity #when a member learns or renders #then membership remains but memory stays off", async () => {
  const f = fixture = await scopeFixture()
  await f.members("A", null, [worker])
  expect(await f.callAs("worker", "memberForSession")).toMatchObject({ memory_identity: null })
  expect(await f.prompt("worker", "BASE \n")).toBe("BASE \n")
  const refused = await f.learn("worker", { text: "no repository" })
  expect(refused.isError).toBe(true)
  expect(refused.details.reason).toMatch(/memory_identity/)
})

test("#given invalid connector payloads #when pushed #then they are refused without changing membership", async () => {
  const f = fixture = await scopeFixture()
  const base = { scope: "A", memory_identity: "team-A", expected_version: 0, now: 1000, members: [worker] }
  for (const payload of [
    { ...base, version: 1000 }, { ...base, expected_version: 0.5 }, { ...base, memory_identity: "" },
    { ...base, members: [{ ...worker, role: "owner" }] },
    { ...base, members: [{ ...worker, role: "lead" }, { session_durable_id: "other", role: "lead" }] },
    { ...base, members: [{ ...worker, scope: "B" }] },
    { ...base, members: [worker, worker] },
    { ...base, now: -1 },
  ]) {
    expect((await f.store.extensionCall("gateway_rules", "scopeMembersCommitted", payload)).kind).toBe("refused")
  }
  expect(await f.call<{ readonly version: number }>("scopeMembersVersion", { scope: "A" })).toEqual({ version: 0 })
  expect(await f.callAs("worker", "memberForSession")).toBeNull()
})

test("#given no engine caller or no membership #when learning is called #then it is refused without creating a repository", async () => {
  const f = fixture = await scopeFixture()
  await f.members("A", "team-A", [{ session_durable_id: "A-worker", role: "worker" }])
  const tool = f.pi.tools.find((entry) => entry.name === "gateway_learning")
  if (typeof tool?.execute !== "function") throw new Error("gateway_learning is not registered")
  const missing = await Reflect.apply(tool.execute, tool, ["test", { text: "no caller" }])
  expect(missing.isError).toBe(true)
  expect(missing.details.reason.length).toBeGreaterThan(0)
  const unbound = await f.learn("unbound", { text: "not a member" })
  expect(unbound.isError).toBe(true)
  expect(unbound.details.reason.length).toBeGreaterThan(0)
  expect(await f.repo("team-A").head()).toBeNull()
})

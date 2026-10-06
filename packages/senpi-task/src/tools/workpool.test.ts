import { expect, test } from "bun:test"
import { Value } from "typebox/value"
import * as engine from "../index"
import { filterSharedParentTools } from "../runners/in-process/shared-tool-filter"
import { createWorkpoolStore } from "../workpool/store"
import { WorkpoolCommandSchema } from "../workpool/schema"
import { fixture, poolInput } from "../workpool/__fixtures__/admission"
import { buildWorkpoolExecute } from "./workpool"
import { WorkpoolParams, WorkpoolYieldParams } from "./workpool-schema"
import { registerProcessWorkpoolWorker } from "../workpool/process-worker"
import type { TSchema } from "typebox"

function host() {
  const f = fixture()
  const deps = { manager: f.manager, workpools: f.manager.workpools, omoConfig: {}, agents: {} }
  return { ...f, execute: buildWorkpoolExecute(deps), ctx: { cwd: f.root, sessionManager: { getSessionId: () => f.caller.sessionId } } }
}
test("#given the host tool barrel #when registering workpool #then the engine exposes one factory", () => {
  // given / when / then
  const f = host()
  expect(engine.createWorkpoolTool({ manager: f.manager, workpools: f.manager.workpools, omoConfig: {}, agents: {} }).name).toBe("workpool")
})
test("#given inherited scheduler tools #when a child receives shared tools #then workpool family is excluded", () => {
  // given / when / then
  const tools = ["workpool", "workpool_admin", "workflow", "task", "task_send", "team_create", "read"].map(name => ({ name }))
  expect(filterSharedParentTools(tools).map(tool => tool.name)).toEqual(["read"])
})
test("#given all operation schemas #when valid machine requests are parsed #then mode and yield exclusivity are preserved", () => {
  // given
  const poolId = `wp_${"a".repeat(32)}`
  const requests = [
    { op: "create", ...poolInput },
    { op: "create", name: poolInput.name, agent: poolInput.agent },
    { op: "push", pool_id: poolId, items: [{ key: "k", input: { list: [null, true, 42, "s"] } }] },
    ...["close", "inspect", "cancel"].map(op => ({ op, pool_id: poolId })),
    { op: "yield", results: [{ key: "k", data: null }, { key: "e", error: { code: "failed", message: "fixture" } }] },
  ]
  // when / then
  expect(WorkpoolParams.type).toBe("object")
  expect("anyOf" in WorkpoolParams).toBe(false)
  for (const request of requests) { expect(Value.Check(WorkpoolParams, request)).toBe(true); expect(WorkpoolCommandSchema.safeParse(request).success).toBe(true) }
  expect(Value.Check(WorkpoolYieldParams, requests[0])).toBe(false)
})
test("#given malformed or forged requests #when the host parses them #then no worker or pool is created", async () => {
  // given
  const f = host()
  const invalid = [
    { op: "create", ...poolInput, name: " " },
    { op: "create", ...poolInput, parent_session_id: "owner" },
    { op: "create", ...poolInput, agent: { prompt: "p", category: "quick", subagent_type: "worker" } },
    { op: "create", ...poolInput, agent: { prompt: "p" } },
    { op: "yield", task_id: "st_00000001", results: [] },
    { op: "yield", results: [{ key: "k", data: 1, error: { code: "e", message: "m" } }] },
    { op: "yield", results: [{ key: "k" }] },
    { op: "push", pool_id: `wp_${"a".repeat(32)}`, items: [{ key: " ", input: 1 }] },
    { op: "push", pool_id: `wp_${"a".repeat(32)}`, items: [{ key: "k", input: () => 1 }] },
    { op: "push", pool_id: "st_00000001", items: [] },
  ]
  // when / then
  for (const request of invalid) {
    const response = await f.execute(request, f.ctx)
    expect(response.isError).toBe(true)
    expect(response.details.error).toMatchObject({ code: "invalid_input" })
  }
  expect(f.starts).toEqual([])
  expect(createWorkpoolStore(f.store.stateDir).list()).toEqual([])
})
test("#given reserved tools or a gated agent #when creating a pool #then typed denial cannot fabricate success", async () => {
  // given
  const f = host()
  // when / then
  // No live parent JS kernel on this host context: a requested worker tool fails closed, and a
  // reserved host name is refused before any capability is consulted.
  expect((await f.execute({ op: "create", ...poolInput, tools: ["lookup"] }, f.ctx)).details.error).toMatchObject({ code: "tools_unavailable" })
  expect((await f.execute({ op: "create", ...poolInput, tools: ["task_send"] }, f.ctx)).details.error).toMatchObject({ code: "reserved_tool_name" })
  expect((await f.execute({ op: "create", ...poolInput, agent: { subagent_type: "plan-reviewer", prompt: "st_11111111 succeeded" } }, f.ctx)).details.error).toMatchObject({ code: "policy_denied" })
  expect((await f.execute({ op: "yield", results: [] }, f.ctx)).details.error).toMatchObject({ code: "worker_unassigned" })
  expect(f.store.list().records).toEqual([])
})
test("#given parent and same-root siblings #when a host request supplies runtime identity #then only exact parent operations are authorized", async () => {
  // given
  const f = host()
  const pool = f.manager.workpools.create(f.caller, poolInput)
  const foreign = { ...f.ctx, sessionManager: { getSessionId: () => f.caller.rootSessionId } }
  // when / then
  for (const op of ["push", "close", "inspect", "cancel"]) {
    const response = await f.execute({ op, pool_id: pool.pool_id, ...(op === "push" ? { items: [] } : {}) }, foreign)
    expect(response.details.error).toMatchObject({ code: "scope_denied" })
  }
  expect(f.manager.workpools.inspect(f.caller, pool.pool_id).status).toBe("open")
})
test("#given keyed input #when canonical duplicates or conflicts arrive #then admission is atomic and IDs are stable", () => {
  // given
  const f = host()
  const pool = f.manager.workpools.create(f.caller, poolInput)
  expect(f.manager.workpools.create(f.caller, poolInput).pool_id).toBe(pool.pool_id)
  const a = f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: { x: 1, y: [2] } }])
  // when / then
  expect(f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: { y: [2], x: 1 } }])).toEqual(a)
  expect(() => f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "b", input: 3 }, { key: "a", input: 2 }])).toThrow(engine.WorkpoolError)
  expect(f.manager.workpools.inspect(f.caller, pool.pool_id).items).toHaveLength(1)
  expect(() => f.manager.workpools.create(f.caller, { ...poolInput, mode: "keep_alive" })).toThrow(engine.WorkpoolError)
  expect(f.manager.workpools.close(f.caller, pool.pool_id).status).toBe("closing")
  expect(() => f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "c", input: 3 }])).toThrow(engine.WorkpoolError)
  expect(() => f.manager.workpools.create(f.caller, poolInput)).toThrow(engine.WorkpoolError)
})
test("#given an assigned worker #when it forges another key or parent operation #then the yield-only capability refuses", async () => {
  // given
  const f = host()
  const pool = f.manager.workpools.create(f.caller, poolInput)
  const dispatched = f.manager.workpools.waitForEvent(pool.pool_id, "dispatched", AbortSignal.timeout(5000))
  f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: 1 }])
  const event = await dispatched
  if (event.task_id === undefined) throw new Error("missing assignment")
  const taskId = event.task_id
  expect(f.starts[0]?.memberScopedTools?.map(tool => tool.name)).toEqual(["workpool"])
  // when / then
  const workerCaller = { ...f.caller, sessionId: `worker-${taskId}` }
  expect(() => f.manager.workpools.create(workerCaller, poolInput)).toThrow(engine.WorkpoolError)
  expect(() => f.manager.workpools.inspect(workerCaller, pool.pool_id)).toThrow(engine.WorkpoolError)
  expect(() => f.manager.workpools.yieldResults(taskId, 0, { op: "create", ...poolInput })).toThrow(engine.WorkpoolError)
  expect(f.manager.workpools.yieldResults(taskId, 0, { op: "yield", results: [{ key: "other", data: 1 }] })).toMatchObject({
    results: [{ status: "refused", error: { code: "stale_assignment" } }],
  })
  expect(f.manager.workpools.yieldResults(taskId, 0, { op: "yield", results: [{ key: "a", data: 1 }] })).toMatchObject({
    results: [{ key: "a", status: "accepted" }],
  })
})

test("#given a process worker launch #when the member bundle registers #then only the owning yield schema is exposed", async () => {
  // given
  const f = fixture({ config: { default_execution_mode: "process" } })
  const pool = f.manager.workpools.create(f.caller, poolInput)
  const dispatched = f.manager.workpools.waitForEvent(pool.pool_id, "dispatched", AbortSignal.timeout(5000))
  f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: 1 }])
  await dispatched
  const env = f.starts[0]?.memberEnv
  if (env === undefined) throw new Error("missing process identity")
  const tools: { name: string; parameters: TSchema }[] = []
  // when / then
  expect(registerProcessWorkpoolWorker({ registerTool: tool => { tools.push(tool) } }, env)).toBe(true)
  expect(tools.map(tool => tool.name)).toEqual(["workpool"])
  expect(Value.Check(tools[0].parameters, { op: "create", ...poolInput })).toBe(false)
  expect(Value.Check(tools[0].parameters, { op: "yield", results: [{ key: "a", data: 1 }] })).toBe(true)
  expect(() => registerProcessWorkpoolWorker({ registerTool: tool => { tools.push(tool) } }, { ...env, OMO_WORKPOOL_TASK_ID: "st_00000000" })).toThrow(engine.WorkpoolError)
})

test("#given a queued plan-gated worker #when the host policy changes before grant #then the admission path fails closed", async () => {
  // given
  const f = fixture()
  let executing = false
  const execute = buildWorkpoolExecute({ manager: f.manager, workpools: f.manager.workpools, omoConfig: {}, agents: {},
    resolveSkillInvocations: () => ({ hasInvoked: name => name === "ulw-execute" && executing, hasUserRequested: () => true, hasPlanArtifact: () => true, planArtifactReferences: () => [] }) })
  const ctx = { cwd: f.root, sessionManager: { getSessionId: () => f.caller.sessionId } }
  f.concurrency.tryAcquire("test/model", "st_00000001", 0)
  const created = await execute({ op: "create", name: "gated", mode: "fresh", agent: { subagent_type: "plan-consultant", prompt: "Inspect the plan" } }, ctx)
  expect(created.isError).not.toBe(true)
  const poolId = created.details.pool_id
  if (typeof poolId !== "string") throw new Error("missing pool ID")
  const pool = f.manager.workpools.inspect(f.caller, poolId)
  const waiting = f.manager.workpools.waitForEvent(pool.pool_id, "waiting", AbortSignal.timeout(5000))
  const failed = f.manager.workpools.waitForEvent(pool.pool_id, "admission_failed", AbortSignal.timeout(5000))
  await execute({ op: "push", pool_id: pool.pool_id, items: [{ key: "a", input: 1 }] }, ctx)
  await waiting
  // when
  executing = true
  f.concurrency.releaseLease("st_00000001", 0)
  // then
  expect((await failed).error?.code).toBe("policy_denied")
  expect(f.starts).toEqual([])
  expect(f.concurrency.getRetainedKeyCounts().leases).toBe(0)
})

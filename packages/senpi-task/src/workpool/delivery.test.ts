import { expect, test } from "bun:test"
import * as Value from "typebox/value"
import { createTaskRecordStore } from "../store"
import { loadSenpiBarrel } from "../lazy/senpi-barrel"
import { buildChildSessionOptions } from "../runners/in-process/child-options"
import { createWorkpoolWorkerTool } from "../tools/workpool"
import { WorkpoolError } from "./types"
import { createWorkpoolStore } from "./store"
import { restartedFixture } from "./__fixtures__/restart"
import { signal } from "./__fixtures__/delivery"
import { evidence } from "./__fixtures__/admission"
import { bounded, deferred, deliveryFixture } from "./__fixtures__/delivery"

test("#given parked worker #when drains queued items into one revive turn #then durable queue and keyed results survive", async () => {
  // given
  const f = deliveryFixture()
  const first = await f.start()
  await f.settle(first.taskId)
  await f.park(first.taskId)
  const captured = deferred<string>()
  const ack = deferred<void>()
  f.followUp(async message => { captured.resolve(message); await ack.promise })
  f.manager.workpools.subscribe(event => { if (event.kind === "admission_failed") captured.reject(new Error(event.error?.code)) })
  // when
  const a = f.push("a", 2)
  const b = f.push("b", 3)
  const message = await bounded(captured.promise)
  const before = createTaskRecordStore({ project_dir: f.root }).load(first.taskId)
  f.push("later", 4)
  const dispatched = f.event("dispatched")
  ack.resolve()
  const turn = await dispatched
  // then
  expect(before?.pending_steering).toHaveLength(2)
  expect(before?.pending_steering?.map(entry => entry.id)).toEqual([a.item_ids[0]?.item_id, b.item_ids[0]?.item_id])
  expect(before?.notification.run_epoch).toBe(first.epoch + 1)
  expect(f.children.get(first.taskId)?.followUps).toEqual([message])
  expect(f.resumes).toHaveLength(1)
  expect(f.resumes[0]?.memberScopedTools?.map(tool => tool.name)).toEqual(["workpool"])
  expect(f.store.load(first.taskId)?.pending_steering ?? []).toEqual([])
  expect(f.inspect().items.find(item => item.key === "later")?.status).toBe("queued")
  const yielded = f.yieldResults(first.taskId, turn.run_epoch ?? -1, [{ key: "a", data: { n: 2 } }, { key: "b", data: { n: 3 } }])
  expect(yielded).toMatchObject({ results: [{ key: "a", status: "accepted" }, { key: "b", status: "accepted" }] })
  expect(f.inspect().items.filter(item => item.key === "a" || item.key === "b")).toMatchObject([{ status: "completed", data: { n: 2 } }, { status: "completed", data: { n: 3 } }])
  evidence("happy", { before, after: f.store.load(first.taskId), first, turn, yielded, pool: f.inspect() })
})

test("#given fresh item #when canonical key is pushed again after yield #then its result and identity are reused", async () => {
  // given
  const f = deliveryFixture({ mode: "fresh" })
  const worker = await f.start("a")
  const prior = f.inspect().items[0]
  // when
  f.yieldResults(worker.taskId, worker.epoch, [{ key: "a", data: { ok: true } }])
  await f.settle(worker.taskId)
  const receipt = f.push("a")
  // then
  expect(f.turns[0]?.pending).toHaveLength(1)
  expect(f.children.get(worker.taskId)?.followUps).toEqual([])
  expect(receipt.item_ids[0]?.item_id).toBe(prior?.item_id)
  expect(f.inspect().items[0]).toMatchObject({ status: "completed", data: { ok: true } })
  expect(() => f.push("a", 2)).toThrow(WorkpoolError)
  expect(f.turns).toHaveLength(1)
})

test("#given a curated worker #when the engine grants its yield wrapper #then reporting is available without scheduler or write tools", async () => {
  // given
  const f = deliveryFixture({ mode: "fresh" })
  const { SessionManager } = await loadSenpiBarrel()
  const tool = createWorkpoolWorkerTool({ workpools: f.manager.workpools, taskId: "st_00000001", runEpoch: () => 0 })
  // when
  const options = buildChildSessionOptions({ spec: {
    taskId: "st_00000001", parentSessionId: "parent", rootSessionId: "root", depth: 1,
    cwd: f.root, sessionDir: f.root, prompt: "fixture", agentType: "explore", toolAllowlist: ["read"], memberScopedTools: [tool],
  }, sessionManager: SessionManager.inMemory(f.root), sharedParentTools: [], uiOnlyToolNames: [] })
  // then
  expect(options.customTools?.map(tool => tool.name)).toEqual(["workpool", "bash"])
  expect(options.tools).toEqual(["read", "workpool"])
})

test("#given malformed yield siblings #when the actual worker tool schema admits the envelope #then valid entries reach independent reconciliation", async () => {
  // given
  const f = deliveryFixture()
  const worker = await f.start("a")
  const tool = f.turns[0]?.spec.memberScopedTools?.[0]
  if (tool === undefined) throw new Error("missing worker tool")
  const input = { op: "yield", results: [null, { key: "a", data: 42 }] }
  // when / then
  expect(Value.Check(tool.parameters, input)).toBe(true)
  expect(Value.Check(tool.parameters, { ...input, op: "create" })).toBe(false)
  const result = f.manager.workpools.yieldResults(worker.taskId, worker.epoch, input)
  expect(result.results).toMatchObject([{ status: "refused", error: { code: "invalid_input" } }, { key: "a", status: "accepted" }])
})

test("#given a crash before steering append #when a new manager attaches #then one recovered batched turn runs without replaying the original prompt", async () => {
  // given
  const f = deliveryFixture()
  const worker = await f.start()
  await f.settle(worker.taskId)
  await f.park(worker.taskId)
  f.manager.workpools.dispose()
  f.push("recovered")
  createWorkpoolStore(f.store.stateDir).mutate(f.pool.pool_id, pool => ({ ...pool,
    items: pool.items.map(item => item.key === "recovered" ? { ...item, status: "assigned", binding: { task_id: worker.taskId, run_epoch: 1, generation: 1 }, delivery: { phase: "queued" } } : item),
    workers: pool.workers.map(item => ({ ...item, status: "busy", run_epoch: 1 })),
  }))
  const restarted = restartedFixture(f.root)
  try {
    const dispatched = restarted.manager.workpools.waitForEvent(f.pool.pool_id, "dispatched", signal())
    // when
    restarted.manager.workpools.attach(f.caller)
    const turn = await dispatched
    // then
    expect(turn).toMatchObject({ task_id: worker.taskId, run_epoch: 1 })
    expect(restarted.queues).toHaveLength(1)
    expect(restarted.queues[0]).toHaveLength(1)
    expect(restarted.children.get(worker.taskId)?.followUps).toHaveLength(1)
    expect(restarted.store.load(worker.taskId)?.pending_steering ?? []).toEqual([])
    expect(restarted.manager.workpools.yieldResults(worker.taskId, 1, { op: "yield", results: [{ key: "recovered", data: 42 }] }).results[0]?.status).toBe("accepted")
    const idle = restarted.manager.workpools.waitForEvent(f.pool.pool_id, "worker_idle", signal())
    restarted.children.get(worker.taskId)?.settle({ status: "completed", finalResponse: "fixture" })
    await idle
    expect(restarted.manager.workpools.inspect(f.caller, f.pool.pool_id).items[1]).toMatchObject({ status: "completed", data: 42 })
  } finally { await restarted.cleanup() }
})

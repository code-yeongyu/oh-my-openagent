import { expect, test } from "bun:test"
import { createTaskManager } from "../manager/manager"
import { TaskConcurrency } from "../manager/concurrency"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { createTaskLifecycle } from "../lifecycle"
import type { ResidencyRegistry } from "../lifecycle/port"
import { createTaskRecordStore } from "../store"
import { bounded, fixture, fixtureHandle, poolInput } from "./__fixtures__/admission"
import type { WorkpoolAggregateMessage, WorkpoolAggregatePort } from "./aggregate"

function acking(messages: WorkpoolAggregateMessage[]): WorkpoolAggregatePort {
  return { enqueue: (message, receipts) => { messages.push(message); receipts.ack() } }
}
function hanging(messages: WorkpoolAggregateMessage[]): WorkpoolAggregatePort {
  return { enqueue: message => { messages.push(message) } }
}
function reopen(root: string) {
  const config = OmoTaskSettingsSchema.parse({ default_concurrency: 1, global_concurrency: 1, residency_max_children: 4 })
  const store = createTaskRecordStore({ project_dir: root })
  const concurrency = new TaskConcurrency(config)
  const runner = { start: async (spec: { taskId: string }) => fixtureHandle(spec.taskId).handle }
  const registry: ResidencyRegistry = { get: () => undefined, entries: () => [], forget: () => undefined, hasPendingSends: () => false, tryClaimEviction: () => false, releaseEviction: () => undefined }
  const lifecycle = createTaskLifecycle({ store, registry, config })
  const manager = createTaskManager({ store, concurrency, runners: { "in-process": runner, process: runner }, config, cwd: root,
    planner: spec => ({ kind: "resolved", plan: { model: spec.model ?? "test/model" } }), destruction: lifecycle, admit: async () => ({ kind: "admitted" }) })
  return { manager, lifecycle }
}

test("#given omitted mode #when creating a pool #then the approved keep_alive default is installed", () => {
  const f = fixture()
  const { mode, ...omitted } = poolInput
  expect(mode).toBe("fresh")
  expect(f.manager.workpools.create(f.caller, omitted).mode).toBe("keep_alive")
  expect(f.manager.workpools.create(f.caller, { ...poolInput, name: "fresh-batch" }).mode).toBe("fresh")
})

test("#given empty close #when the aggregate port is bound #then one empty result list is delivered once", () => {
  const f = fixture()
  const messages: WorkpoolAggregateMessage[] = []
  f.manager.workpools.bindAggregate(acking(messages))
  const pool = f.manager.workpools.create(f.caller, poolInput)
  const closed = f.manager.workpools.close(f.caller, pool.pool_id)
  expect(closed).toMatchObject({ pool_id: pool.pool_id, generation: 1, status: "closing" })
  expect(messages).toEqual([{ pool_id: pool.pool_id, generation: 1, results: [] }])
  f.manager.workpools.close(f.caller, pool.pool_id)
  expect(messages).toHaveLength(1)
  expect(f.manager.workpools.inspect(f.caller, pool.pool_id).aggregate).toEqual({ generation: 1, delivered: true })
})

test("#given keyed yields then close #when results are terminal #then one input-order aggregate is delivered", async () => {
  const f = fixture()
  const messages: WorkpoolAggregateMessage[] = []
  f.manager.workpools.bindAggregate(acking(messages))
  const pool = f.manager.workpools.create(f.caller, poolInput)
  const dispatched = f.manager.workpools.waitForEvent(pool.pool_id, "dispatched", AbortSignal.timeout(5000))
  f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "b", input: 2 }])
  const event = await bounded(dispatched)
  expect(event.task_id).toBeDefined()
  expect(f.manager.workpools.yieldResults(event.task_id!, event.run_epoch ?? 0, { op: "yield", results: [{ key: "b", data: 2 }] }).results[0]?.status).toBe("accepted")
  f.manager.workpools.close(f.caller, pool.pool_id)
  expect(messages).toEqual([{ pool_id: pool.pool_id, generation: 1, results: [{ key: "b", data: 2 }] }])
  f.manager.workpools.yieldResults(event.task_id!, event.run_epoch ?? 0, { op: "yield", results: [{ key: "b", data: 2 }] })
  expect(messages).toHaveLength(1)
})

test("#given notifier throw #when close is empty #then aggregate stays pending, emits, and recovers", () => {
  const f = fixture()
  const failures: string[] = []
  f.manager.workpools.subscribe(event => { if (event.kind === "aggregate_failed") failures.push(event.error?.message ?? "") })
  f.manager.workpools.bindAggregate({ enqueue: () => { throw new Error("notifier down") } })
  const pool = f.manager.workpools.create(f.caller, poolInput)
  f.manager.workpools.close(f.caller, pool.pool_id)
  expect(f.manager.workpools.inspect(f.caller, pool.pool_id).aggregate?.delivered).not.toBe(true)
  expect(failures).toEqual(["notifier down"])
  const messages: WorkpoolAggregateMessage[] = []
  f.manager.workpools.bindAggregate(acking(messages))
  expect(messages).toEqual([{ pool_id: pool.pool_id, generation: 1, results: [] }])
})

test("#given cancel of unstarted items #when a lane is held #then waiters are removed and no spawn happens", async () => {
  const f = fixture()
  f.concurrency.tryAcquire("test/model", "st_00000001", 0)
  const pool = f.manager.workpools.create(f.caller, poolInput)
  const waiting = f.manager.workpools.waitForEvent(pool.pool_id, "waiting", AbortSignal.timeout(5000))
  f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: 1 }])
  await bounded(waiting)
  expect(f.starts).toHaveLength(0)
  const cancelled = f.manager.workpools.cancel(f.caller, pool.pool_id)
  expect(cancelled.items[0]).toMatchObject({ key: "a", status: "cancelled", error: { code: "cancelled" } })
  expect(f.starts).toHaveLength(0)
})

test("#given an accepted-then-lost aggregate #when attach runs on a fresh engine #then the aggregate is redelivered exactly once", () => {
  const lost: WorkpoolAggregateMessage[] = []
  const f = fixture()
  f.manager.workpools.bindAggregate(hanging(lost))
  const pool = f.manager.workpools.create(f.caller, poolInput)
  f.manager.workpools.close(f.caller, pool.pool_id)
  expect(lost).toEqual([{ pool_id: pool.pool_id, generation: 1, results: [] }])
  expect(f.manager.workpools.inspect(f.caller, pool.pool_id).aggregate).toEqual({ generation: 1, delivered: false, accepted: true })
  f.manager.workpools.dispose()
  const recovered: WorkpoolAggregateMessage[] = []
  const restarted = reopen(f.root)
  try {
    restarted.manager.workpools.bindAggregate(acking(recovered))
    restarted.manager.workpools.attach(f.caller)
    expect(recovered).toEqual(lost)
    restarted.manager.workpools.attach(f.caller)
    expect(recovered).toHaveLength(1)
    expect(restarted.manager.workpools.inspect(f.caller, pool.pool_id).aggregate).toEqual({ generation: 1, delivered: true })
  } finally { restarted.manager.workpools.dispose(); restarted.lifecycle.dispose?.() }
})

test("#given an accepted aggregate in the same process #when noteAggregateFailure runs #then accepted clears and a later bind redelivers once", () => {
  const lost: WorkpoolAggregateMessage[] = []
  const f = fixture()
  f.manager.workpools.bindAggregate(hanging(lost))
  const pool = f.manager.workpools.create(f.caller, poolInput)
  f.manager.workpools.close(f.caller, pool.pool_id)
  expect(f.manager.workpools.inspect(f.caller, pool.pool_id).aggregate).toEqual({ generation: 1, delivered: false, accepted: true })
  f.manager.workpools.noteAggregateFailure(pool.pool_id, 1)
  expect(f.manager.workpools.inspect(f.caller, pool.pool_id).aggregate).toEqual({ generation: 1, delivered: false })
  const recovered: WorkpoolAggregateMessage[] = []
  f.manager.workpools.bindAggregate(acking(recovered))
  expect(recovered).toEqual(lost)
  f.manager.workpools.bindAggregate(acking(recovered))
  expect(recovered).toHaveLength(1)
})

test("#given a delivered aggregate #when attach runs on a fresh engine #then it is not duplicated", () => {
  const delivered: WorkpoolAggregateMessage[] = []
  const g = fixture()
  g.manager.workpools.bindAggregate(acking(delivered))
  const ok = g.manager.workpools.create(g.caller, { ...poolInput, name: "acked" })
  g.manager.workpools.close(g.caller, ok.pool_id)
  expect(delivered).toHaveLength(1)
  expect(g.manager.workpools.inspect(g.caller, ok.pool_id).aggregate).toEqual({ generation: 1, delivered: true })
  g.manager.workpools.dispose()
  const after = reopen(g.root)
  try {
    after.manager.workpools.bindAggregate(acking(delivered))
    after.manager.workpools.attach(g.caller)
    expect(delivered).toHaveLength(1)
  } finally { after.manager.workpools.dispose(); after.lifecycle.dispose?.() }
})

test("#given a persisted pool #when a fresh engine inspects #then the same pool is observed", () => {
  const f = fixture()
  const pool = f.manager.workpools.create(f.caller, poolInput)
  f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: 1 }])
  const restarted = reopen(f.root)
  try {
    expect(restarted.manager.workpools.inspect(f.caller, pool.pool_id)).toMatchObject({ pool_id: pool.pool_id, items: [{ key: "a" }] })
  } finally { restarted.manager.workpools.dispose(); restarted.lifecycle.dispose?.() }
})

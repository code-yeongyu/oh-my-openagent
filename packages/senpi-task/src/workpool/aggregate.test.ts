import { expect, test } from "bun:test"
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createTaskManager } from "../manager/manager"
import { TaskConcurrency } from "../manager/concurrency"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { createTaskLifecycle } from "../lifecycle"
import type { ResidencyRegistry } from "../lifecycle/port"
import { createTaskRecordStore } from "../store"
import { bounded, fixture, fixtureHandle, poolInput } from "./__fixtures__/admission"
import type { WorkpoolAggregateMessage, WorkpoolAggregatePort } from "./aggregate"
import { NO_HOST_ENDPOINT } from "../lifecycle/host-session"
import { deliveryFixture } from "./__fixtures__/delivery"
import { createWorkpoolStore } from "./store"
import { createWorkpoolYieldCapability } from "./worker-capability"

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
  const registry: ResidencyRegistry = { get: () => undefined, entries: () => [], forget: (_taskId, _options) => undefined, hasPendingSends: () => false, tryClaimEviction: () => false, releaseEviction: () => undefined }
  const lifecycle = createTaskLifecycle({ hostEndpoint: NO_HOST_ENDPOINT, store, registry, config })
  const manager = createTaskManager({ store, concurrency, runners: { "in-process": runner, process: runner }, config, cwd: root,
    planner: spec => ({ kind: "resolved", plan: { model: spec.model ?? "test/model" } }), destruction: lifecycle, admit: async () => ({ kind: "admitted" }) })
  return { manager, lifecycle, concurrency }
}

for (const failure of ["missing", "corrupt"] as const) test(`#given a ${failure} pool record #when its scheduled pump fails #then admission reports the load error without a second exception`, async () => {
  // given
  const f = fixture()
  const pool = f.manager.workpools.create(f.caller, poolInput)
  const failed = f.manager.workpools.waitForEvent(pool.pool_id, "admission_failed", AbortSignal.timeout(5000))
  const path = join(f.store.stateDir, "workpools", `${pool.pool_id}.json`)
  // when
  if (failure === "missing") rmSync(path)
  else writeFileSync(path, "{")
  const event = await bounded(failed)
  // then
  expect(event).toMatchObject({ pool_id: pool.pool_id, error: { code: failure === "missing" ? "pool_not_found" : "store_corrupt" } })
  expect(event.item_id).toBeUndefined()
})

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

test("#given a closing pool whose last binding is refused #when admission fails #then its aggregate is delivered once", async () => {
  // given
  const f = deliveryFixture()
  const messages: WorkpoolAggregateMessage[] = []
  f.manager.workpools.bindAggregate(acking(messages))
  const worker = await f.start()
  f.yieldResults(worker.taskId, worker.epoch, [{ key: "first", data: 1 }])
  f.push("recovered")
  f.store.mutate(worker.taskId, record => ({ ...record, burnt_epoch: worker.epoch + 1 }))
  createWorkpoolStore(f.store.stateDir).mutate(f.pool.pool_id, pool => ({ ...pool, items: pool.items.map(item => item.key === "recovered"
    ? { ...item, status: "assigned", binding: { task_id: worker.taskId, generation: pool.generation, run_epoch: worker.epoch + 1 }, delivery: { phase: "queued" } } : item) }))
  f.manager.workpools.close(f.caller, f.pool.pool_id)
  const failed = f.event("admission_failed")
  // when
  f.children.get(worker.taskId)?.settle({ status: "completed", finalResponse: "turn finished" })
  await failed
  // then
  expect(messages).toMatchObject([{ pool_id: f.pool.pool_id, results: [{ key: "first", data: 1 }, { key: "recovered", error: { code: "worker_not_continuable" } }] }])
  expect(f.inspect().aggregate).toEqual({ generation: f.pool.generation, delivered: true })
  f.manager.workpools.close(f.caller, f.pool.pool_id)
  expect(messages).toHaveLength(1)
})

for (const closeBeforeFailure of [true, false]) for (const durableYield of [true, false]) for (const terminalBeforeFailure of [false, true]) test(`#given uncertain admission and close ${closeBeforeFailure ? "before" : "after"} failure #when the task becomes terminal ${terminalBeforeFailure ? "before" : "after"} failure ${durableYield ? "with" : "without"} a durable yield #then only the final aggregate is delivered`, async () => {
  // given
  const f = deliveryFixture()
  const messages: WorkpoolAggregateMessage[] = []
  f.manager.workpools.bindAggregate(acking(messages))
  const worker = await f.start()
  f.yieldResults(worker.taskId, worker.epoch, [{ key: "first", data: 1 }])
  await f.settle(worker.taskId)
  await f.park(worker.taskId)
  const recordDurableYield = () => {
    const pools = createWorkpoolStore(f.store.stateDir)
    const crash = createWorkpoolYieldCapability({ ...pools, mutate: (id, update) => {
      update(pools.load(id))
      throw new Error("fixture crash before pool result replace")
    } }, f.store)
    expect(() => crash(worker.taskId, worker.epoch + 1, { op: "yield", results: [{ key: "late-yield", data: 42 }] })).toThrow()
  }
  f.followUp(async (_message, taskId) => {
    if (terminalBeforeFailure) {
      if (durableYield) recordDurableYield()
      f.store.mutate(taskId, record => ({ ...record, status: "completed" }))
    }
    throw new Error("fixture lost acknowledgment")
  })
  const failures: ReturnType<typeof f.inspect>[] = []
  f.manager.workpools.subscribe(event => { if (event.kind === "admission_failed") failures.push(f.inspect()) })
  const failed = f.event("admission_failed")
  const idle = terminalBeforeFailure ? f.event("worker_idle") : undefined
  f.push("late-yield")
  if (closeBeforeFailure) f.manager.workpools.close(f.caller, f.pool.pool_id)
  await failed
  if (!closeBeforeFailure) f.manager.workpools.close(f.caller, f.pool.pool_id)
  expect(failures).toHaveLength(1)
  expect(failures[0]?.items[1]?.error?.code).toBe("delivery_uncertain")
  expect(failures[0]?.workers.find(candidate => candidate.task_id === worker.taskId)).toMatchObject({ status: "busy", run_epoch: worker.epoch + 1 })
  // when
  if (idle !== undefined) await bounded(idle)
  else {
    expect(messages).toHaveLength(0)
    expect(f.inspect().aggregate?.delivered).not.toBe(true)
    if (durableYield) recordDurableYield()
    await f.settle(worker.taskId)
  }
  // then
  if (durableYield) expect(messages).toEqual([{ pool_id: f.pool.pool_id, generation: f.pool.generation, results: [{ key: "first", data: 1 }, { key: "late-yield", data: 42 }] }])
  else expect(messages).toMatchObject([{ pool_id: f.pool.pool_id, generation: f.pool.generation, results: [{ key: "first", data: 1 }, { key: "late-yield", error: { code: "delivery_uncertain" } }] }])
  expect(f.inspect().aggregate).toEqual({ generation: f.pool.generation, delivered: true })
  f.manager.workpools.attach(f.caller)
  expect(messages).toHaveLength(1)
})

for (const flush of ["close", "bind"] as const) for (const durableYield of [true, false]) test(`#given another engine sharing an uncertain turn #when it flushes through ${flush} #then it waits for completion ${durableYield ? "with" : "without"} a durable yield`, async () => {
  // given
  const f = deliveryFixture()
  const messages: WorkpoolAggregateMessage[] = []
  f.manager.workpools.bindAggregate(acking(messages))
  const worker = await f.start()
  f.yieldResults(worker.taskId, worker.epoch, [{ key: "first", data: 1 }])
  await f.settle(worker.taskId)
  await f.park(worker.taskId)
  const other = reopen(f.root)
  try {
    if (flush === "close") other.manager.workpools.bindAggregate(acking(messages))
    f.followUp(async () => { throw new Error("fixture lost acknowledgment") })
    const failed = f.event("admission_failed")
    f.push("late-yield")
    await failed
    // when
    if (flush === "close") other.manager.workpools.close(f.caller, f.pool.pool_id)
    else {
      f.manager.workpools.close(f.caller, f.pool.pool_id)
      other.manager.workpools.bindAggregate(acking(messages))
    }
    // then
    expect(f.inspect().items[1]?.error?.code).toBe("delivery_uncertain")
    expect(messages).toHaveLength(0)
    expect(f.inspect().aggregate?.delivered).not.toBe(true)
    if (durableYield) {
      const pools = createWorkpoolStore(f.store.stateDir)
      const crash = createWorkpoolYieldCapability({ ...pools, mutate: (id, update) => {
        update(pools.load(id))
        throw new Error("fixture crash before pool result replace")
      } }, f.store)
      expect(() => crash(worker.taskId, worker.epoch + 1, { op: "yield", results: [{ key: "late-yield", data: 42 }] })).toThrow()
    }
    await f.settle(worker.taskId)
    if (durableYield) expect(messages).toEqual([{ pool_id: f.pool.pool_id, generation: f.pool.generation, results: [{ key: "first", data: 1 }, { key: "late-yield", data: 42 }] }])
    else expect(messages).toMatchObject([{ pool_id: f.pool.pool_id, generation: f.pool.generation, results: [{ key: "first", data: 1 }, { key: "late-yield", error: { code: "delivery_uncertain" } }] }])
    expect(f.inspect().aggregate).toEqual({ generation: f.pool.generation, delivered: true })
    other.manager.workpools.close(f.caller, f.pool.pool_id)
    other.manager.workpools.attach(f.caller)
    expect(messages).toHaveLength(1)
  } finally { other.manager.workpools.dispose(); other.lifecycle.dispose?.() }
})

for (const durableYield of [true, false]) test(`#given a shared closing pool with persisted uncertainty #when a later ordinary admission failure arrives #then reconciliation delivers once ${durableYield ? "with" : "without"} a durable yield`, async () => {
  // given
  const f = deliveryFixture()
  const messages: WorkpoolAggregateMessage[] = []
  f.manager.workpools.bindAggregate(acking(messages))
  const worker = await f.start()
  f.yieldResults(worker.taskId, worker.epoch, [{ key: "first", data: 1 }])
  await f.settle(worker.taskId)
  await f.park(worker.taskId)
  f.manager.workpools.dispose()
  const other = reopen(f.root)
  const blocker = "st_00000001"
  expect(other.concurrency.tryAcquire("test/model", blocker, 0)).toBe(true)
  try {
    const pools = createWorkpoolStore(f.store.stateDir)
    const waiting = other.manager.workpools.waitForEvent(f.pool.pool_id, "waiting", AbortSignal.timeout(5000))
    const recovered = other.manager.workpools.push(f.caller, f.pool.pool_id, [{ key: "late-yield", input: 1 }]).item_ids[0]?.item_id
    pools.mutate(f.pool.pool_id, pool => ({ ...pool, items: pool.items.map(item => item.item_id === recovered
      ? { ...item, status: "assigned", binding: { task_id: worker.taskId, generation: pool.generation, run_epoch: worker.epoch + 1 }, delivery: { phase: "queued" } }
      : item) }))
    await bounded(waiting)
    other.manager.workpools.bindAggregate(acking(messages))
    other.manager.workpools.close(f.caller, f.pool.pool_id)
    let interleaved = false
    other.manager.workpools.subscribe(event => {
      if (event.kind !== "granted" || event.item_id !== recovered) return
      interleaved = true
      f.store.mutate(worker.taskId, record => ({ ...record, status: "completed", notification: { ...record.notification, run_epoch: worker.epoch + 1 },
        revive_delivery_uncertain: { run_epoch: worker.epoch + 1, message_sha256: "0".repeat(64) },
      }))
      pools.mutate(f.pool.pool_id, pool => ({ ...pool,
        items: pool.items.map(item => item.item_id === recovered ? { ...item, status: "error", error: { code: "delivery_uncertain", message: "lost acknowledgment" },
          delivery: { phase: "dispatching", message_sha256: "0".repeat(64) } } : item),
        workers: pool.workers.map(candidate => candidate.task_id === worker.taskId ? { ...candidate, run_epoch: worker.epoch + 1, status: "busy" } : candidate),
      }))
      if (durableYield) expect(createWorkpoolYieldCapability(pools, f.store)(worker.taskId, worker.epoch + 1, {
        op: "yield", results: [{ key: "late-yield", data: 42 }],
      })).toMatchObject({ results: [{ status: "accepted" }] })
    })
    const failed = other.manager.workpools.waitForEvent(f.pool.pool_id, "admission_failed", AbortSignal.timeout(5000))
    // when
    other.concurrency.releaseLease(blocker, 0)
    expect(await bounded(failed)).toMatchObject({ task_id: worker.taskId, run_epoch: worker.epoch + 1, error: { code: "worker_not_continuable" } })
    // then
    expect(interleaved).toBe(true)
    expect(pools.load(f.pool.pool_id).items[1]?.error?.code).toBe("delivery_uncertain")
    expect(pools.load(f.pool.pool_id).workers.find(candidate => candidate.task_id === worker.taskId)).toMatchObject({ status: "busy", run_epoch: worker.epoch + 1 })
    expect(messages).toHaveLength(0)
    other.manager.workpools.attach(f.caller)
    if (durableYield) expect(messages).toEqual([{ pool_id: f.pool.pool_id, generation: f.pool.generation, results: [{ key: "first", data: 1 }, { key: "late-yield", data: 42 }] }])
    else expect(messages).toMatchObject([{ pool_id: f.pool.pool_id, generation: f.pool.generation, results: [{ key: "first", data: 1 }, { key: "late-yield", error: { code: "delivery_uncertain" } }] }])
    other.manager.workpools.attach(f.caller)
    expect(messages).toHaveLength(1)
  } finally {
    other.manager.workpools.dispose()
    other.lifecycle.dispose?.()
    other.concurrency.releaseLease(blocker, 0)
  }
})

test("#given two owners recovering the same binding #when the loser fails eligibility after the winner dispatches #then the winner remains able to yield", async () => {
  // given
  const f = deliveryFixture()
  const worker = await f.start()
  f.yieldResults(worker.taskId, worker.epoch, [{ key: "first", data: 1 }])
  await f.settle(worker.taskId)
  await f.park(worker.taskId)
  const other = reopen(f.root)
  const blocker = "st_00000001"
  expect(f.concurrency.tryAcquire("test/model", blocker, 0)).toBe(true)
  expect(other.concurrency.tryAcquire("test/model", blocker, 0)).toBe(true)
  try {
    const waiting = other.manager.workpools.waitForEvent(f.pool.pool_id, "waiting", AbortSignal.timeout(5000))
    const recovered = f.push("recovered").item_ids[0]?.item_id
    createWorkpoolStore(f.store.stateDir).mutate(f.pool.pool_id, pool => ({ ...pool, items: pool.items.map(item => item.item_id === recovered
      ? { ...item, status: "assigned", binding: { task_id: worker.taskId, generation: pool.generation, run_epoch: worker.epoch + 1 }, delivery: { phase: "queued" } }
      : item) }))
    other.manager.workpools.attach(f.caller)
    await bounded(waiting)
    const dispatched = f.event("dispatched")
    f.concurrency.releaseLease(blocker, 0)
    expect(await bounded(dispatched)).toMatchObject({ task_id: worker.taskId, run_epoch: worker.epoch + 1 })
    const winner = f.inspect().items.find(item => item.item_id === recovered)
    expect(winner).toMatchObject({ status: "assigned", delivery: { phase: "acknowledged" } })
    const failed = other.manager.workpools.waitForEvent(f.pool.pool_id, "admission_failed", AbortSignal.timeout(5000))
    // when
    other.concurrency.releaseLease(blocker, 0)
    expect(await bounded(failed)).toMatchObject({ task_id: worker.taskId, run_epoch: worker.epoch + 1, error: { code: "worker_not_continuable" } })
    // then
    expect(f.inspect().items.find(item => item.item_id === recovered)).toEqual(winner)
    expect(f.inspect().workers.find(candidate => candidate.task_id === worker.taskId)).toMatchObject({ status: "busy", run_epoch: worker.epoch + 1 })
    expect(f.yieldResults(worker.taskId, worker.epoch + 1, [{ key: "recovered", data: 42 }])).toMatchObject({ results: [{ key: "recovered", status: "accepted" }] })
  } finally {
    f.concurrency.releaseLease(blocker, 0)
    other.concurrency.releaseLease(blocker, 0)
    other.manager.workpools.dispose()
    other.lifecycle.dispose?.()
  }
})

for (const closeBeforeCancel of [false, true]) test(`#given an uncertain turn in ${closeBeforeCancel ? "a closing" : "an open"} pool #when cancelled #then its new generation delivers one final aggregate`, async () => {
  // given
  const f = deliveryFixture()
  const messages: WorkpoolAggregateMessage[] = []
  f.manager.workpools.bindAggregate(acking(messages))
  const worker = await f.start()
  f.yieldResults(worker.taskId, worker.epoch, [{ key: "first", data: 1 }])
  await f.settle(worker.taskId)
  await f.park(worker.taskId)
  f.followUp(async () => { throw new Error("fixture lost acknowledgment") })
  const failed = f.event("admission_failed")
  f.push("uncertain")
  await bounded(failed)
  if (closeBeforeCancel) f.manager.workpools.close(f.caller, f.pool.pool_id)
  expect(messages).toHaveLength(0)
  const idle = f.event("worker_idle")
  // when
  const cancelled = f.manager.workpools.cancel(f.caller, f.pool.pool_id)
  await bounded(idle)
  // then
  expect(messages).toMatchObject([{ pool_id: f.pool.pool_id, generation: cancelled.generation, results: [
    { key: "first", data: 1 }, { key: "uncertain", error: { code: "delivery_uncertain" } },
  ] }])
  expect(f.inspect().aggregate).toEqual({ generation: cancelled.generation, delivered: true })
  f.manager.workpools.bindAggregate(acking(messages))
  f.manager.workpools.attach(f.caller)
  expect(messages).toHaveLength(1)
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

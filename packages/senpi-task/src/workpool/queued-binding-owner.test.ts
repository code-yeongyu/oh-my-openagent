import { expect, test } from "bun:test"
import { bounded, deferred } from "./__fixtures__/admission"
import { deliveryFixture } from "./__fixtures__/delivery"
import { createWorkpoolDispatcher } from "./dispatcher"
import type { WorkpoolRequest } from "./ports"
import { createWorkpoolStore } from "./store"
import { appendAssignedMessages, beginWorkerTurn } from "./worker-turn"

function delayedDispatcher(f: ReturnType<typeof deliveryFixture>) {
  const captured = deferred<WorkpoolRequest>()
  const dispatcher = createWorkpoolDispatcher({
    store: createWorkpoolStore(f.store.stateDir),
    admission: {
      tasks: f.store,
      resolve: () => f.inspect().worker_spec,
      hasFreeSlot: () => true,
      request: request => { captured.resolve(request); return { cancel: () => undefined } },
      drain: () => undefined,
      get: taskId => f.store.load(taskId) ?? undefined,
      pending: () => false,
      cancel: async () => undefined,
      waitFor: async () => { throw new Error("Unexpected completion observation") },
    },
    authorize: () => undefined,
    emit: () => undefined,
  })
  return { dispatcher, captured }
}

for (const { name, recovered, previouslyBound } of [
  { name: "newer-epoch", recovered: false, previouslyBound: false },
  { name: "recovered same-epoch", recovered: true, previouslyBound: false },
  { name: "rebound same-epoch", recovered: false, previouslyBound: true },
]) test(`#given a delayed failure before a ${name} queued bind #when another owner binds #then its item and worker survive and begin`, async () => {
  // given
  const f = deliveryFixture()
  const worker = await f.start()
  f.yieldResults(worker.taskId, worker.epoch, [{ key: "first", data: 1 }])
  await f.settle(worker.taskId)
  f.manager.workpools.dispose()
  const pools = createWorkpoolStore(f.store.stateDir)
  const itemId = f.push("next").item_ids[0]?.item_id
  if (itemId === undefined) throw new Error("Missing next item")
  const winningEpoch = worker.epoch + (recovered || previouslyBound ? 1 : 2)
  if (recovered) pools.mutate(f.pool.pool_id, pool => ({ ...pool,
    items: pool.items.map(item => item.item_id === itemId
      ? { ...item, status: "assigned", binding: { task_id: worker.taskId, run_epoch: winningEpoch, generation: pool.generation }, delivery: { phase: "queued" } }
      : item),
    workers: pool.workers.map(item => ({ ...item, run_epoch: winningEpoch, status: "busy" })),
  }))
  const a = delayedDispatcher(f)
  const b = delayedDispatcher(f)
  try {
    a.dispatcher.schedule(f.pool.pool_id)
    const losing = await bounded(a.captured.promise)
    if (previouslyBound) {
      f.push("cohort")
      expect(losing.bind(worker.taskId, worker.epoch + 1)).toBe(true)
      f.push("forwarded")
    }
    b.dispatcher.schedule(f.pool.pool_id)
    const winning = await bounded(b.captured.promise)
    expect(winning.bind(worker.taskId, winningEpoch)).toBe(true)
    const turn = { pool_id: f.pool.pool_id, generation: f.pool.generation, task_id: worker.taskId, run_epoch: winningEpoch }
    appendAssignedMessages({ pools, tasks: f.store }, turn)
    const steering = f.store.load(worker.taskId)?.pending_steering
    const before = pools.load(f.pool.pool_id)
    expect(before.items.find(item => item.item_id === itemId)).toMatchObject({ status: "assigned", delivery: { phase: "queued" } })
    // when
    losing.event({ kind: "admission_failed", pool_id: f.pool.pool_id, item_id: itemId,
      task_id: worker.taskId, run_epoch: worker.epoch + 1,
      error: { code: "worker_not_continuable", message: "The stale epoch failed its recheck." } })
    // then
    expect(pools.load(f.pool.pool_id).items).toEqual(before.items)
    expect(f.store.load(worker.taskId)?.pending_steering).toEqual(steering)
    expect(pools.load(f.pool.pool_id).workers.find(item => item.task_id === worker.taskId))
      .toMatchObject({ task_id: worker.taskId, run_epoch: winningEpoch, status: "busy" })
    const begun = beginWorkerTurn({ pools, tasks: f.store }, turn)
    expect(begun?.entries.map(entry => entry.id)).toEqual(before.items.filter(item => item.status === "assigned").map(item => item.item_id))
    expect(pools.load(f.pool.pool_id).items.find(item => item.item_id === itemId)?.delivery?.phase).toBe("dispatching")
  } finally {
    a.dispatcher.stopScheduling()
    b.dispatcher.stopScheduling()
  }
})

test("#given an owned queued bind and an unrelated pool mutation #when its admission fails #then only its turn is refused", async () => {
  // given
  const f = deliveryFixture()
  const worker = await f.start()
  f.yieldResults(worker.taskId, worker.epoch, [{ key: "first", data: 1 }])
  await f.settle(worker.taskId)
  f.manager.workpools.dispose()
  const itemId = f.push("next").item_ids[0]?.item_id
  if (itemId === undefined) throw new Error("Missing next item")
  const a = delayedDispatcher(f)
  try {
    a.dispatcher.schedule(f.pool.pool_id)
    const request = await bounded(a.captured.promise)
    const epoch = worker.epoch + 1
    expect(request.bind(worker.taskId, epoch)).toBe(true)
    const pools = createWorkpoolStore(f.store.stateDir)
    appendAssignedMessages({ pools, tasks: f.store }, { pool_id: f.pool.pool_id, generation: f.pool.generation, task_id: worker.taskId, run_epoch: epoch })
    const before = pools.load(f.pool.pool_id).revision
    const unrelated = f.push("unrelated").item_ids[0]?.item_id
    expect(pools.load(f.pool.pool_id).revision).toBeGreaterThan(before)
    // when
    request.event({ kind: "admission_failed", pool_id: f.pool.pool_id, item_id: itemId,
      task_id: worker.taskId, run_epoch: epoch,
      error: { code: "worker_not_continuable", message: "The owned turn failed." } })
    // then
    expect(pools.load(f.pool.pool_id).items.find(item => item.item_id === itemId)).toMatchObject({ status: "error" })
    expect(pools.load(f.pool.pool_id).items.find(item => item.item_id === unrelated)).toMatchObject({ status: "queued" })
    const record = f.store.load(worker.taskId)
    expect(record).not.toBeNull()
    expect(record?.pending_steering ?? []).toEqual([])
    expect(pools.load(f.pool.pool_id).workers.some(item => item.task_id === worker.taskId)).toBe(false)
  } finally {
    a.dispatcher.stopScheduling()
  }
})

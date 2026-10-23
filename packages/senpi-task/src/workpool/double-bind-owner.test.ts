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

for (const beginsWith of ["earlier", "later"] as const) test(`#given two recovered same-identity binds #when the ${beginsWith} binder begins and fails #then its dispatched turn terminalizes`, async () => {
  // given
  const f = deliveryFixture()
  const worker = await f.start()
  f.yieldResults(worker.taskId, worker.epoch, [{ key: "first", data: 1 }])
  await f.settle(worker.taskId)
  f.manager.workpools.dispose()
  const itemId = f.push("recovered").item_ids[0]?.item_id
  if (itemId === undefined) throw new Error("Missing recovered item")
  const pools = createWorkpoolStore(f.store.stateDir)
  const epoch = worker.epoch + 1
  pools.mutate(f.pool.pool_id, pool => ({ ...pool,
    items: pool.items.map(item => item.item_id === itemId
      ? { ...item, status: "assigned", binding: { task_id: worker.taskId, run_epoch: epoch, generation: pool.generation }, delivery: { phase: "queued" } }
      : item),
    workers: pool.workers.map(item => ({ ...item, run_epoch: epoch, status: "busy" })),
  }))
  const earlier = delayedDispatcher(f)
  const later = delayedDispatcher(f)
  try {
    earlier.dispatcher.schedule(f.pool.pool_id)
    later.dispatcher.schedule(f.pool.pool_id)
    const first = await bounded(earlier.captured.promise)
    const second = await bounded(later.captured.promise)
    // Both recovery admissions were accepted before either could begin the shared turn.
    expect(first.bind(worker.taskId, epoch)).toBe(true)
    const firstRevision = pools.load(f.pool.pool_id).revision
    expect(second.bind(worker.taskId, epoch)).toBe(true)
    expect(pools.load(f.pool.pool_id).revision).toBeGreaterThan(firstRevision)
    const turn = { pool_id: f.pool.pool_id, generation: f.pool.generation, task_id: worker.taskId, run_epoch: epoch }
    appendAssignedMessages({ pools, tasks: f.store }, turn)
    const winner = beginsWith === "earlier" ? first : second
    // when
    expect(beginWorkerTurn({ pools, tasks: f.store }, turn)).toBeDefined()
    winner.event({ kind: "admission_failed", pool_id: f.pool.pool_id, item_id: itemId, task_id: worker.taskId, run_epoch: epoch,
      error: { code: "worker_not_continuable", message: "ordinary revival failure" } })
    // then
    const item = pools.load(f.pool.pool_id).items.find(candidate => candidate.item_id === itemId)
    expect(item).toMatchObject({ status: "error", error: { code: "worker_not_continuable" }, delivery: { phase: "dispatching" } })
    expect(pools.load(f.pool.pool_id).workers.some(candidate => candidate.task_id === worker.taskId && candidate.run_epoch === epoch)).toBe(false)
  } finally {
    earlier.dispatcher.stopScheduling()
    later.dispatcher.stopScheduling()
  }
})

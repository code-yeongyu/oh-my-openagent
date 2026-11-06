import { expect, test } from "bun:test"
import { bounded, deferred } from "./__fixtures__/admission"
import { deliveryFixture } from "./__fixtures__/delivery"
import { createWorkpoolDispatcher } from "./dispatcher"
import type { WorkpoolRequest } from "./ports"
import { createWorkpoolStore } from "./store"

test("#given different tasks at the same epoch #when a losing admission fails after a live winner #then the winner can still yield", async () => {
  // given
  const f = deliveryFixture({ mode: "fresh" })
  const blocker = "st_00000001"
  expect(f.concurrency.tryAcquire("test/model", blocker, 0)).toBe(true)
  const captured = deferred<WorkpoolRequest>()
  const loser = createWorkpoolDispatcher({
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
  try {
    const started = f.start()
    loser.schedule(f.pool.pool_id)
    const request = await bounded(captured.promise)
    f.concurrency.releaseLease(blocker, 0)
    const winner = await bounded(started)
    const item = f.inspect().items[0]
    expect(winner.epoch).toBe(0)
    expect(winner.taskId).not.toBe("st_00000002")
    expect(item).toMatchObject({ status: "assigned", binding: { task_id: winner.taskId, run_epoch: 0 } })
    expect(item?.delivery).toBeDefined()
    expect(item?.delivery?.phase).not.toBe("queued")
    // when
    request.event({
      kind: "admission_failed", pool_id: f.pool.pool_id, item_id: request.item.item_id,
      task_id: "st_00000002", run_epoch: 0,
      error: { code: "admission_refused", message: "fixture losing admission" },
    })
    // then
    expect(f.inspect().items[0]).toEqual(item)
    expect(f.yieldResults(winner.taskId, 0, [{ key: "first", data: 42 }])).toMatchObject({
      results: [{ key: "first", status: "accepted" }],
    })
  } finally {
    loser.stopScheduling()
    f.concurrency.releaseLease(blocker, 0)
  }
})

for (const hasCapacity of [true, false]) test(`#given a superseded recovered bind with ${hasCapacity ? "free" : "full"} capacity #when its winner idles #then the losing dispatcher can reuse that worker`, async () => {
  // given
  const f = deliveryFixture()
  const worker = await f.start()
  f.yieldResults(worker.taskId, worker.epoch, [{ key: "first", data: 1 }])
  await f.settle(worker.taskId)
  f.manager.workpools.dispose()
  const pools = createWorkpoolStore(f.store.stateDir)
  const recovered = f.push("recovered").item_ids[0]?.item_id
  if (recovered === undefined) throw new Error("Missing recovered item")
  pools.mutate(f.pool.pool_id, pool => ({ ...pool,
    items: pool.items.map(item => item.item_id === recovered
      ? { ...item, status: "assigned", binding: { task_id: worker.taskId, run_epoch: worker.epoch + 1, generation: pool.generation }, delivery: { phase: "queued" } }
      : item),
    workers: pool.workers.map(item => ({ ...item, run_epoch: worker.epoch + 1, status: "busy" })),
  }))
  const captured = deferred<WorkpoolRequest>()
  const selected = deferred<WorkpoolRequest | undefined>()
  const loser = createWorkpoolDispatcher({
    store: pools,
    admission: {
      tasks: f.store,
      resolve: () => f.inspect().worker_spec,
      hasFreeSlot: () => { if (!hasCapacity) selected.resolve(undefined); return hasCapacity },
      request: request => {
        if (request.item.item_id === recovered) captured.resolve(request)
        else selected.resolve(request)
        return { cancel: () => undefined }
      },
      drain: () => undefined,
      get: taskId => f.store.load(taskId) ?? undefined,
      pending: () => false,
      cancel: async () => undefined,
      waitFor: async () => { throw new Error("Unexpected completion observation") },
    },
    authorize: () => undefined,
    emit: () => undefined,
  })
  try {
    loser.schedule(f.pool.pool_id)
    const request = await bounded(captured.promise)
    expect(request.worker?.task_id).toBe(worker.taskId)
    const winning = pools.mutate(f.pool.pool_id, pool => ({ ...pool, items: pool.items.map(item => item.item_id === recovered
      ? { ...item, delivery: { phase: "dispatching", message_sha256: "0".repeat(64) } } : item) })).items.find(item => item.item_id === recovered)
    // when
    expect(request.bind(worker.taskId, worker.epoch + 1)).toBe(false)
    // then
    expect(pools.load(f.pool.pool_id).items.find(item => item.item_id === recovered)).toEqual(winning)
    pools.mutate(f.pool.pool_id, pool => ({ ...pool,
      items: pool.items.map(item => item.item_id === recovered
        ? { ...item, status: "completed", data: 42, yield_sha256: "1".repeat(64), delivery: { phase: "acknowledged", message_sha256: "0".repeat(64) } }
        : item),
      workers: pool.workers.map(item => ({ ...item, status: "idle", completed_turns: 1 })),
    }))
    f.push("next")
    loser.schedule(f.pool.pool_id)
    const next = await bounded(selected.promise)
    expect(next?.worker?.task_id).toBe(worker.taskId)
    expect(next?.item.key).toBe("next")
    expect(pools.load(f.pool.pool_id).items.find(item => item.item_id === recovered)).toMatchObject({ status: "completed", data: 42 })
  } finally {
    loser.stopScheduling()
  }
})

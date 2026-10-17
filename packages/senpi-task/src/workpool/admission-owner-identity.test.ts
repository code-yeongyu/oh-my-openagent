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

import { expect, test } from "bun:test"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { TaskConcurrency } from "../manager/concurrency"
import { createWorkpoolAdmission } from "../manager/workpool-admission"
import type { SendOutcome } from "../steering/types"
import type { TaskRecordStore } from "../store"
import { bounded, deferred } from "./__fixtures__/admission"
import { deliveryFixture } from "./__fixtures__/delivery"
import { createWorkpoolDispatcher } from "./dispatcher"
import type { WorkpoolRequest } from "./ports"
import { createWorkpoolStore } from "./store"
import type { WorkpoolEvent } from "./types"

function captureDispatcher(f: ReturnType<typeof deliveryFixture>) {
  const captured = deferred<WorkpoolRequest>()
  const dispatcher = createWorkpoolDispatcher({
    store: createWorkpoolStore(f.store.stateDir),
    admission: {
      tasks: f.store, resolve: () => f.inspect().worker_spec, hasFreeSlot: () => true,
      request: request => { captured.resolve(request); return { cancel: () => undefined } },
      drain: () => undefined, get: id => f.store.load(id) ?? undefined, pending: () => false, cancel: async () => undefined,
      waitFor: (_id, signal) => new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }) }),
    },
    authorize: () => undefined, emit: () => undefined,
  })
  return { dispatcher, captured }
}

for (const winnerOrder of ["earlier", "later"] as const) test(`#given two same-identity binds with the ${winnerOrder} binder winning begin #when the loser fails appending #then the winner can yield`, async () => {
  // given
  const f = deliveryFixture()
  const worker = await f.start()
  f.yieldResults(worker.taskId, worker.epoch, [{ key: "first", data: 1 }])
  await f.settle(worker.taskId)
  f.manager.workpools.dispose()
  const itemId = f.push("recovered").item_ids[0]?.item_id
  if (itemId === undefined) throw new Error("Missing recovered item")
  const epoch = worker.epoch + 1
  const pools = createWorkpoolStore(f.store.stateDir)
  pools.mutate(f.pool.pool_id, pool => ({ ...pool,
    items: pool.items.map(item => item.item_id === itemId
      ? { ...item, status: "assigned", binding: { task_id: worker.taskId, run_epoch: epoch, generation: pool.generation }, delivery: { phase: "queued" } } : item),
    workers: pool.workers.map(item => ({ ...item, run_epoch: epoch, status: "busy" })),
  }))
  const winner = captureDispatcher(f)
  const loser = captureDispatcher(f)
  const revived = deferred<SendOutcome>()
  const winnerFinished = deferred<WorkpoolEvent>()
  const failure = deferred<WorkpoolEvent>()
  const config = OmoTaskSettingsSchema.parse({ default_concurrency: 1, global_concurrency: 1, residency_max_children: 4 })
  const leases: TaskConcurrency[] = []
  let armed = false
  let appendFailures = 0
  let winnerRevives = 0
  let loserRevives = 0
  const rejectingStore: TaskRecordStore = { ...f.store, mutate: (id, change) => {
    if (armed && id === worker.taskId) { appendFailures++; throw new Error("fixture append lock timeout") }
    return f.store.mutate(id, change)
  } }
  function admission(store: TaskRecordStore, isWinner: boolean) {
    const concurrency = new TaskConcurrency(config)
    leases.push(concurrency)
    return createWorkpoolAdmission({
      options: { store, config, cwd: f.root, destruction: f.lifecycle,
        planner: () => ({ kind: "resolved", plan: { model: "test/model" } }),
        runners: { "in-process": { start: async () => { throw new Error("Unexpected fresh worker") } }, process: { start: async () => { throw new Error("Unexpected process worker") } } },
      },
      concurrency, hostPid: process.pid, get: id => f.store.load(id) ?? undefined, pending: () => false,
      cancel: async () => undefined,
      waitFor: (_id, signal) => new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }) }),
      launch: async () => { throw new Error("Unexpected fresh launch") },
      revive: async (_record, _message, reservation) => {
        if (!isWinner) { loserRevives++; throw new Error("Losing admission must not revive") }
        winnerRevives++
        f.store.mutate(worker.taskId, record => ({ ...record, status: "running", notification: { ...record.notification, run_epoch: epoch } }))
        if (!reservation.ok) throw new Error("Expected an admitted revival reservation")
        reservation.commit()
        return revived.promise
      },
      trackRevive: () => undefined, nextSequence: () => 1, workerTools: () => [],
    })
  }
  try {
    winner.dispatcher.schedule(f.pool.pool_id)
    loser.dispatcher.schedule(f.pool.pool_id)
    const winning = await bounded(winner.captured.promise)
    const losing = await bounded(loser.captured.promise)
    const prebound = winnerOrder === "earlier" ? winning.bind(worker.taskId, epoch) : undefined
    if (prebound !== undefined) expect(prebound).toBe(true)
    const winningAdmission = admission(f.store, true)
    const losingAdmission = admission(rejectingStore, false)
    winningAdmission.request({ ...winning,
      bind: (id, runEpoch) => prebound ?? winning.bind(id, runEpoch),
      event: event => { winning.event(event); if (event.kind === "dispatched" || event.kind === "admission_failed") winnerFinished.resolve(event) },
    })
    losingAdmission.request({ ...losing,
      bind: (id, runEpoch) => {
        const bound = losing.bind(id, runEpoch)
        expect(bound).toBe(true)
        winningAdmission.drain()
        armed = true
        return bound
      },
      event: event => { losing.event(event); if (event.kind === "admission_failed") failure.resolve(event) },
    })
    // when
    losingAdmission.drain()
    const failed = await bounded(failure.promise)
    // then
    expect(failed.error).toEqual({ code: "spawn_failed", message: "fixture append lock timeout" })
    expect(appendFailures).toBe(1)
    expect(winnerRevives).toBe(1)
    expect(loserRevives).toBe(0)
    expect(pools.load(f.pool.pool_id).items.find(item => item.item_id === itemId)).toMatchObject({
      status: "assigned", binding: { task_id: worker.taskId, run_epoch: epoch }, delivery: { phase: "dispatching" },
    })
    expect(pools.load(f.pool.pool_id).workers).toContainEqual(expect.objectContaining({ task_id: worker.taskId, run_epoch: epoch, status: "busy" }))
    revived.resolve({ kind: "revived", task_id: worker.taskId, run_epoch: epoch })
    expect((await bounded(winnerFinished.promise)).kind).toBe("dispatched")
    expect(f.yieldResults(worker.taskId, epoch, [{ key: "recovered", data: 42 }])).toMatchObject({ results: [{ key: "recovered", status: "accepted" }] })
  } finally {
    armed = false
    revived.resolve({ kind: "revived", task_id: worker.taskId, run_epoch: epoch })
    if (winnerRevives > 0) await bounded(winnerFinished.promise)
    winner.dispatcher.stopScheduling()
    loser.dispatcher.stopScheduling()
    for (const concurrency of leases) concurrency.releaseLease(worker.taskId, epoch)
  }
})

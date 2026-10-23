import { describe, expect, spyOn, test } from "bun:test"
import { failureReceipt, runRecoveryCases } from "./__fixtures__/recovery"
import { deliveryFixture } from "./__fixtures__/delivery"
import { createWorkpoolStore } from "./store"
import { appendAssignedMessages } from "./worker-turn"

describe("uncertain delivery never redispatches", () => {
test("#given ack loss and reload #when uncertain delivery never redispatches #then every affected key retains identity and uncertainty", async () => {
  // given
  const f = deliveryFixture()
  const first = await f.start()
  await f.settle(first.taskId)
  await f.park(first.taskId)
  f.followUp(async () => { throw new Error("fixture acknowledgment lost") })
  const failed = f.event("admission_failed")
  // when
  f.push("a", 2)
  f.push("b", 3)
  await failed
  const persisted = createWorkpoolStore(f.store.stateDir).load(f.pool.pool_id)
  f.manager.workpools.attach(f.caller)
  const duplicate = f.push("a", 2)
  // then
  expect(persisted.items.filter(item => item.key !== "first")).toMatchObject([
    { status: "error", error: { code: "delivery_uncertain" }, binding: { task_id: first.taskId, run_epoch: 1 }, delivery: { message_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) } },
    { status: "error", error: { code: "delivery_uncertain" } },
  ])
  expect(duplicate.item_ids[0]?.item_id).toBe(persisted.items[1]?.item_id)
  expect(f.resumes).toHaveLength(1)
  expect(f.inspect().items).toEqual(persisted.items)
  failureReceipt("ack-loss", { persisted, duplicate, resumes: f.resumes.map(spec => spec.taskId), events: f.events })
})

test("#given worker completion without yield #when prose claims success #then item_missing_yield is persisted", async () => {
  // given
  const f = deliveryFixture()
  const worker = await f.start("a")
  // when
  await f.settle(worker.taskId)
  // then
  expect(f.inspect().items[0]).toMatchObject({ status: "error", error: { code: "item_missing_yield" } })
  failureReceipt("missing-yield", f.inspect())
})

test("#given mixed valid and foreign yields #when accepted twice then conflicted #then valid siblings survive and identity fences hold", async () => {
  // given
  const f = deliveryFixture()
  const worker = await f.start("a")
  // when
  const accepted = f.yieldResults(worker.taskId, worker.epoch, [{ key: "unknown", data: 0 }, { key: "a", data: 1 }])
  const duplicate = f.yieldResults(worker.taskId, worker.epoch, [{ key: "a", data: 1 }])
  const conflict = f.yieldResults(worker.taskId, worker.epoch, [{ key: "a", data: 2 }])
  // then
  expect(accepted).toMatchObject({ results: [{ key: "unknown", status: "refused", error: { code: "stale_assignment" } }, { key: "a", status: "accepted" }] })
  expect(duplicate).toMatchObject({ results: [{ key: "a", status: "duplicate" }] })
  expect(conflict).toMatchObject({ results: [{ key: "a", status: "refused", error: { code: "yield_conflict" } }] })
  expect(() => f.yieldResults(worker.taskId, worker.epoch + 1, [{ key: "a", data: 1 }])).toThrow()
  expect(f.inspect().items[0]).toMatchObject({ status: "completed", data: 1 })
  failureReceipt("yield-identity", { accepted, duplicate, conflict, pool: f.inspect() })
})

for (const denial of ["evicted", "one-shot"] as const) test(`#given ${denial} worker #when queued pushes need reuse #then a typed error does not discard other queued keys`, async () => {
  // given
  const f = deliveryFixture()
  const worker = await f.start()
  await f.settle(worker.taskId)
  f.store.mutate(worker.taskId, record => denial === "evicted" ? { ...record, residency_state: "evicted" } : { ...record, agent_type: "plan-reviewer" })
  const failed = f.event("admission_failed")
  const dispatched = f.event("dispatched")
  // when
  f.push("denied")
  f.push("survivor")
  const refusal = await failed
  const replacement = await dispatched
  // then
  expect(refusal.error?.code).toBe("worker_not_continuable")
  expect(f.inspect().mode).toBe("keep_alive")
  expect(f.inspect().items.find(item => item.key === "denied")?.error?.code).toBe("worker_not_continuable")
  expect(f.inspect().items.find(item => item.key === "survivor")?.status).toBe("assigned")
  expect(replacement.task_id).not.toBe(worker.taskId)
  expect(f.resumes).toEqual([])
  failureReceipt(denial, { refusal, replacement, pool: f.inspect() })
})

test("#given a recovered assignment whose epoch the worker record moved past #when its turn binds #then admission fails visibly instead of leaving the item pending", async () => {
  // given
  const f = deliveryFixture()
  const worker = await f.start()
  f.push("recovered")
  f.store.mutate(worker.taskId, record => ({ ...record, burnt_epoch: worker.epoch + 1 }))
  createWorkpoolStore(f.store.stateDir).mutate(f.pool.pool_id, pool => ({ ...pool, items: pool.items.map(item => item.key === "recovered"
    ? { ...item, status: "assigned", binding: { task_id: worker.taskId, generation: pool.generation, run_epoch: worker.epoch + 1 }, delivery: { phase: "queued" } }
    : item) }))
  const failed = f.event("admission_failed")
  // when
  f.children.get(worker.taskId)?.settle({ status: "completed", finalResponse: "turn finished" })
  const refusal = await failed
  // then
  expect(refusal).toMatchObject({ task_id: worker.taskId, run_epoch: worker.epoch + 2, error: { code: "worker_not_continuable" } })
  expect(f.inspect().items.find(item => item.key === "recovered")).toMatchObject({ status: "error", error: { code: "worker_not_continuable" } })
  expect(createWorkpoolStore(f.store.stateDir).load(f.pool.pool_id).workers).toContainEqual(expect.objectContaining({ task_id: worker.taskId, run_epoch: worker.epoch, status: "idle" }))
  const dispatched = f.event("dispatched")
  f.push("next")
  expect(await dispatched).toMatchObject({ task_id: worker.taskId, run_epoch: worker.epoch + 2 })
  failureReceipt("bind-refused", { refusal, pool: f.inspect() })
})
test("#given a refused recovered binding with durable input #when admission fails #then only its undelivered steering is removed", async () => {
  // given
  const f = deliveryFixture()
  const worker = await f.start()
  f.push("recovered")
  const pools = createWorkpoolStore(f.store.stateDir)
  const turn = { pool_id: f.pool.pool_id, task_id: worker.taskId, generation: f.pool.generation, run_epoch: worker.epoch + 1 }
  pools.mutate(f.pool.pool_id, pool => ({ ...pool, items: pool.items.map(item => item.key === "recovered"
    ? { ...item, status: "assigned", binding: { task_id: turn.task_id, generation: turn.generation, run_epoch: turn.run_epoch }, delivery: { phase: "queued" } } : item) }))
  appendAssignedMessages({ pools, tasks: f.store }, turn)
  const retained = { id: "retained-followup", message: "unrelated input", deliver_as: "followUp" as const }
  f.store.mutate(worker.taskId, record => ({ ...record, burnt_epoch: worker.epoch + 1, pending_steering: [...(record.pending_steering ?? []), retained] }))
  const failed = f.event("admission_failed")
  // when
  f.children.get(worker.taskId)?.settle({ status: "completed", finalResponse: "turn finished" })
  await failed
  // then
  expect(f.inspect().items.find(item => item.key === "recovered")?.status).toBe("error")
  expect(f.store.load(worker.taskId)?.pending_steering).toEqual([retained])
})
test("#given a recovered turn another engine owner already began #when this owner's bind loses #then the winner's item is left alone", async () => {
  // given
  const f = deliveryFixture()
  const worker = await f.start()
  await f.settle(worker.taskId)
  const pools = createWorkpoolStore(f.store.stateDir)
  const recovered = f.push("recovered").item_ids[0]?.item_id
  pools.mutate(f.pool.pool_id, pool => ({ ...pool, items: pool.items.map(item => item.item_id === recovered
    ? { ...item, status: "assigned", binding: { task_id: worker.taskId, generation: pool.generation, run_epoch: worker.epoch + 1 }, delivery: { phase: "queued" } }
    : item) }))
  const load = f.store.load.bind(f.store)
  let otherOwnerBegan = false
  const spy = spyOn(f.store, "load").mockImplementation(taskId => {
    if (!otherOwnerBegan && taskId === worker.taskId) {
      otherOwnerBegan = true
      pools.mutate(f.pool.pool_id, pool => ({ ...pool, items: pool.items.map(item => item.item_id === recovered
        ? { ...item, delivery: { phase: "dispatching", message_sha256: "0".repeat(64) } }
        : item) }))
    }
    return load(taskId)
  })
  const granted = f.event("granted")
  // when
  await granted
  spy.mockRestore()
  // then
  expect(otherOwnerBegan).toBe(true)
  expect(f.events.filter(event => event.kind === "admission_failed" && event.item_id === recovered)).toEqual([])
  expect(f.inspect().items.find(item => item.item_id === recovered)).toMatchObject({ status: "assigned", delivery: { phase: "dispatching" } })
})
for (const winnerStatus of ["assigned", "completed"] as const) test(`#given another owner's ${winnerStatus} turn while admission fails #when the failure is recorded #then its item and pool worker are left alone`, async () => {
  // given
  const f = deliveryFixture()
  const worker = await f.start()
  await f.settle(worker.taskId)
  const pools = createWorkpoolStore(f.store.stateDir)
  const recovered = f.push("recovered").item_ids[0]?.item_id
  pools.mutate(f.pool.pool_id, pool => ({ ...pool, items: pool.items.map(item => item.item_id === recovered
    ? { ...item, status: "assigned", binding: { task_id: worker.taskId, generation: pool.generation, run_epoch: worker.epoch + 1 }, delivery: { phase: "queued" } }
    : item) }))
  const load = f.store.load.bind(f.store)
  let workerLoads = 0
  const spy = spyOn(f.store, "load").mockImplementation(taskId => {
    const record = load(taskId)
    if (taskId !== worker.taskId || record === null) return record
    workerLoads += 1
    if (workerLoads > 1) return { ...record, notification: { ...record.notification, run_epoch: record.notification.run_epoch + 1 } }
    pools.mutate(f.pool.pool_id, pool => ({ ...pool, items: pool.items.map(item => item.item_id === recovered
      ? { ...item, status: winnerStatus, ...(winnerStatus === "completed" ? { data: 42, yield_sha256: "1".repeat(64) } : {}), delivery: { phase: winnerStatus === "completed" ? "acknowledged" : "dispatching", message_sha256: "0".repeat(64) } }
      : item), workers: [...pool.workers.filter(candidate => candidate.task_id !== worker.taskId),
      { task_id: worker.taskId, run_epoch: worker.epoch + 1, status: winnerStatus === "completed" ? "idle" : "busy", completed_turns: winnerStatus === "completed" ? 1 : 0, idle_since: 0 }] }))
    return record
  })
  const failed = f.event("admission_failed")
  // when
  const refusal = await failed
  spy.mockRestore()
  // then
  expect(refusal).toMatchObject({ item_id: recovered, error: { code: "worker_not_continuable" } })
  expect(f.inspect().items.find(item => item.item_id === recovered)).toMatchObject({ status: winnerStatus, delivery: { phase: winnerStatus === "completed" ? "acknowledged" : "dispatching" } })
  expect(pools.load(f.pool.pool_id).workers.find(candidate => candidate.task_id === worker.taskId)).toMatchObject({ run_epoch: worker.epoch + 1, status: winnerStatus === "completed" ? "idle" : "busy" })
})
runRecoveryCases()
})

import { describe, expect, test } from "bun:test"
import { failureReceipt, runRecoveryCases } from "./__fixtures__/recovery"
import { deliveryFixture } from "./__fixtures__/delivery"
import { createWorkpoolStore } from "./store"

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
runRecoveryCases()
})

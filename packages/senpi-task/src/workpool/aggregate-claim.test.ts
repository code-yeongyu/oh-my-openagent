import { expect, spyOn, test } from "bun:test"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { createTaskLifecycle } from "../lifecycle"
import { NO_HOST_ENDPOINT } from "../lifecycle/host-session"
import type { ResidencyRegistry } from "../lifecycle/port"
import { TaskConcurrency } from "../manager/concurrency"
import { createTaskManager } from "../manager/manager"
import { createTaskRecordStore } from "../store"
import { bounded, fixture, fixtureHandle, poolInput } from "./__fixtures__/admission"
import { deliveryFixture } from "./__fixtures__/delivery"
import type { WorkpoolAggregateMessage, WorkpoolAggregateReceipts } from "./aggregate"
import { createWorkpoolStore } from "./store"

function reopen(root: string) {
  const config = OmoTaskSettingsSchema.parse({ default_concurrency: 1, global_concurrency: 1, residency_max_children: 4 })
  const store = createTaskRecordStore({ project_dir: root })
  const concurrency = new TaskConcurrency(config)
  const runner = { start: async (spec: { taskId: string }) => fixtureHandle(spec.taskId).handle }
  const registry: ResidencyRegistry = { get: () => undefined, entries: () => [], forget: (_taskId, _options) => undefined, hasPendingSends: () => false, tryClaimEviction: () => false, releaseEviction: () => undefined }
  const lifecycle = createTaskLifecycle({ hostEndpoint: NO_HOST_ENDPOINT, store, registry, config })
  const manager = createTaskManager({ store, concurrency, runners: { "in-process": runner, process: runner }, config, cwd: root,
    planner: spec => ({ kind: "resolved", plan: { model: spec.model ?? "test/model" } }), destruction: lifecycle, admit: async () => ({ kind: "admitted" }) })
  return { manager, lifecycle }
}

function interleaveSnapshot(poolId: string, ready: () => boolean, action: () => void) {
  const parse = JSON.parse
  let fired = false
  const observer = spyOn(JSON, "parse").mockImplementation((text, reviver) => {
    const value: unknown = parse(text, reviver)
    if (!fired && ready() && value !== null && typeof value === "object" &&
      "pool_id" in value && value.pool_id === poolId && "status" in value && value.status === "closing") {
      fired = true
      action()
    }
    return value
  })
  return { get fired() { return fired }, restore: () => observer.mockRestore() }
}

for (const winner of ["accepted", "delivered", "cancelled"] as const) test(`#given two owners with a stale closing snapshot #when the winner is ${winner} #then only its aggregate is enqueued`, () => {
  // given
  const f = fixture()
  const other = reopen(f.root)
  const messages: WorkpoolAggregateMessage[] = []
  const receipts: WorkpoolAggregateReceipts[] = []
  f.manager.workpools.bindAggregate({ enqueue: (message, receipt) => { messages.push(message); receipt.ack() } })
  other.manager.workpools.bindAggregate({ enqueue: (message, receipt) => {
    messages.push(message)
    receipts.push(receipt)
    if (winner !== "accepted") receipt.ack()
  } })
  const pool = f.manager.workpools.create(f.caller, poolInput)
  const gate = interleaveSnapshot(pool.pool_id, () => true, () => {
    if (winner === "cancelled") other.manager.workpools.cancel(f.caller, pool.pool_id)
    else other.manager.workpools.close(f.caller, pool.pool_id)
  })
  try {
    // when
    f.manager.workpools.close(f.caller, pool.pool_id)
    // then
    expect(gate.fired).toBe(true)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.generation).toBe(winner === "cancelled" ? 2 : 1)
    if (winner === "accepted") {
      expect(f.manager.workpools.inspect(f.caller, pool.pool_id).aggregate).toEqual({ generation: 1, delivered: false, accepted: true })
      const receipt = receipts[0]
      if (receipt === undefined) throw new Error("Missing winning receipt")
      receipt.fail()
      f.manager.workpools.close(f.caller, pool.pool_id)
      expect(messages).toHaveLength(2)
      expect(f.manager.workpools.inspect(f.caller, pool.pool_id).aggregate).toEqual({ generation: 1, delivered: true })
    } else {
      if (winner === "cancelled") f.manager.workpools.noteAggregateFailure(pool.pool_id, 1)
      expect(f.manager.workpools.inspect(f.caller, pool.pool_id).aggregate).toEqual({ generation: winner === "cancelled" ? 2 : 1, delivered: true })
    }
  } finally {
    gate.restore()
    other.manager.workpools.dispose()
    other.lifecycle.dispose?.()
  }
})

test("#given an admission-failed flush holding a stale snapshot #when another owner closes the terminal pool #then one aggregate is enqueued", async () => {
  // given
  const f = deliveryFixture()
  const other = reopen(f.root)
  const messages: WorkpoolAggregateMessage[] = []
  const receipts: WorkpoolAggregateReceipts[] = []
  f.manager.workpools.bindAggregate({ enqueue: (message, receipt) => { messages.push(message); receipt.ack() } })
  other.manager.workpools.bindAggregate({ enqueue: (message, receipt) => { messages.push(message); receipts.push(receipt) } })
  const worker = await f.start()
  f.yieldResults(worker.taskId, worker.epoch, [{ key: "first", data: 1 }])
  const recovered = f.push("recovered").item_ids[0]?.item_id
  f.store.mutate(worker.taskId, record => ({ ...record, burnt_epoch: worker.epoch + 1 }))
  createWorkpoolStore(f.store.stateDir).mutate(f.pool.pool_id, pool => ({ ...pool, items: pool.items.map(item => item.item_id === recovered
    ? { ...item, status: "assigned", binding: { task_id: worker.taskId, generation: pool.generation, run_epoch: worker.epoch + 1 }, delivery: { phase: "queued" } }
    : item) }))
  f.manager.workpools.close(f.caller, f.pool.pool_id)
  let armed = false
  const unsubscribe = f.manager.workpools.subscribe(event => {
    if (event.kind === "admission_failed" && event.item_id === recovered) armed = true
  })
  const gate = interleaveSnapshot(f.pool.pool_id, () => armed, () => { other.manager.workpools.close(f.caller, f.pool.pool_id) })
  const failed = f.event("admission_failed")
  try {
    // when
    f.children.get(worker.taskId)?.settle({ status: "completed", finalResponse: "turn finished" })
    await bounded(failed)
    // then
    expect(gate.fired).toBe(true)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.results).toMatchObject([{ key: "first", data: 1 }, { key: "recovered", error: { code: "worker_not_continuable" } }])
    const receipt = receipts[0]
    if (receipt === undefined) throw new Error("Missing winning receipt")
    receipt.ack()
    expect(f.inspect().aggregate).toEqual({ generation: f.pool.generation, delivered: true })
  } finally {
    gate.restore()
    unsubscribe()
    other.manager.workpools.dispose()
    other.lifecycle.dispose?.()
  }
})

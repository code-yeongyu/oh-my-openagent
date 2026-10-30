import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { deliveryFixture } from "./delivery"
import { createWorkpoolStore } from "../store"
import { createWorkpoolYieldCapability } from "../worker-capability"
import { appendAssignedMessages } from "../worker-turn"
import { reconcileWorkpool } from "../reconcile"
import { evidence } from "./admission"

const observations: unknown[] = []
export function failureReceipt(name: string, value: unknown): void { observations.push({ name, value }); evidence("failure", observations) }
export function runRecoveryCases(): void {
  test("#given assignment persisted before queue append #when restart repairs twice #then item IDs appear once in the durable worker queue", async () => {
    // given
    const f = deliveryFixture()
    const worker = await f.start()
    await f.settle(worker.taskId)
    f.manager.workpools.dispose()
    f.push("repair", 2)
    const pools = createWorkpoolStore(f.store.stateDir)
    const turn = { pool_id: f.pool.pool_id, task_id: worker.taskId, generation: 1, run_epoch: 1 }
    pools.mutate(f.pool.pool_id, pool => ({ ...pool, items: pool.items.map(item => item.key === "repair" ? {
      ...item, status: "assigned", binding: { task_id: worker.taskId, generation: 1, run_epoch: 1 }, delivery: { phase: "queued" },
    } : item) }))
    // when
    reconcileWorkpool({ pools, tasks: f.store }, f.pool.pool_id, () => false)
    appendAssignedMessages({ pools, tasks: f.store }, turn)
    reconcileWorkpool({ pools, tasks: f.store }, f.pool.pool_id, () => false)
    // then
    const queued = f.store.load(worker.taskId)?.pending_steering
    expect(queued).toHaveLength(1)
    expect(queued?.[0]).toMatchObject({ id: pools.load(f.pool.pool_id).items[1]?.item_id, workpool: { pool_id: f.pool.pool_id, generation: 1, key: "repair", run_epoch: 1 } })
    expect(pools.load(f.pool.pool_id).items[1]?.status).toBe("assigned")
    failureReceipt("assignment-queue-gap", { queued, pool: pools.load(f.pool.pool_id) })
  })

  test("#given an unresolved running worker #when restart loads the pool #then its acknowledged delivery becomes uncertainty without replay", async () => {
    // given
    const f = deliveryFixture()
    const worker = await f.start("running")
    f.manager.workpools.dispose()
    const pools = createWorkpoolStore(f.store.stateDir)
    // when
    reconcileWorkpool({ pools, tasks: f.store }, f.pool.pool_id, () => false)
    // then
    expect(pools.load(f.pool.pool_id).items[0]).toMatchObject({ status: "error", error: { code: "delivery_uncertain" }, binding: { task_id: worker.taskId, run_epoch: worker.epoch }, delivery: { message_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) } })
    expect((await f.manager.respawn(f.store.load(worker.taskId) ?? (() => { throw new Error("missing task") })())).ok).toBe(false)
    expect(f.turns).toHaveLength(1)
    failureReceipt("running-reload", pools.load(f.pool.pool_id))
  })

  for (const kind of ["authoritative", "stale", "redacted"] as const) test(`#given ${kind} yield event and uncertain delivery #when completion reconciles #then only authoritative same-identity data can replace uncertainty`, async () => {
    // given
    const f = deliveryFixture()
    const worker = await f.start("a")
    const pools = createWorkpoolStore(f.store.stateDir)
    const item = pools.load(f.pool.pool_id).items[0]
    if (item === undefined) throw new Error("missing assignment")
    if (kind === "stale") {
      const result = { key: "a", data: 99 }
      f.store.appendEvent(worker.taskId, { type: "workpool_yield", payload: { pool_id: f.pool.pool_id, task_id: worker.taskId, run_epoch: worker.epoch + 1, generation: 1, item_id: item.item_id, result, sha256: createHash("sha256").update('{"data":99,"key":"a"}').digest("hex") } })
    } else {
      const crash = createWorkpoolYieldCapability({ ...pools, mutate: (id, update) => {
        update(pools.load(id))
        throw new Error("fixture crash before pool result replace")
      } }, f.store)
      expect(() => crash(worker.taskId, worker.epoch, { op: "yield", results: [{ key: "a", data: kind === "redacted" ? { password: "fixture-value" } : 42 }] })).toThrow()
    }
    pools.mutate(f.pool.pool_id, pool => ({ ...pool, items: pool.items.map(item => ({ ...item, status: "error", error: { code: "delivery_uncertain", message: "fixture uncertainty" } })) }))
    // when
    await f.settle(worker.taskId)
    // then
    expect(f.inspect().items[0]).toMatchObject(kind === "authoritative" ? { status: "completed", data: 42 } : { status: "error", error: { code: "delivery_uncertain" } })
    failureReceipt(`event-${kind}`, f.inspect())
  })

  test("#given cancellation and a stale epoch #when a worker yields #then the generation fence preserves the cancelled result", async () => {
    // given
    const f = deliveryFixture()
    const worker = await f.start("a")
    // when
    f.manager.workpools.cancel(f.caller, f.pool.pool_id)
    // then
    expect(() => f.yieldResults(worker.taskId, worker.epoch, [{ key: "a", data: 1 }])).toThrow()
    expect(f.inspect().generation).toBe(2)
    expect(f.inspect().items[0]?.status).toBe("cancelled")
    failureReceipt("cancelled-generation", f.inspect())
  })

  test("#given malformed and valid results #when one yield batch is parsed #then bad entries do not suppress valid siblings", async () => {
    // given
    const f = deliveryFixture()
    const worker = await f.start("a")
    // when
    const result = f.manager.workpools.yieldResults(worker.taskId, worker.epoch, { op: "yield", results: [null, { key: "bad", data: 1, error: { code: "e", message: "x" } }, { key: "a", error: { code: "analysis_failed", message: "fixture" } }] })
    // then
    expect(result.results).toMatchObject([{ status: "refused", error: { code: "invalid_input" } }, { status: "refused", error: { code: "invalid_input" } }, { key: "a", status: "accepted" }])
    expect(f.inspect().items[0]).toMatchObject({ status: "error", error: { code: "analysis_failed" } })
    failureReceipt("partial-bad-yield", { result, pool: f.inspect() })
  })

  test("#given terminal transition before send acknowledgment #when bookkeeping observes an ended turn #then accepted input remains uncertainty", async () => {
    // given
    const f = deliveryFixture()
    const worker = await f.start()
    await f.settle(worker.taskId)
    await f.park(worker.taskId)
    f.followUp(async (_message, taskId) => {
      f.store.transition(taskId, { type: "complete", timestamp: new Date().toISOString(), final_response: "fixture complete before ack" })
    })
    const failed = f.event("admission_failed")
    // when
    f.push("ended-before-ack")
    await failed
    // then
    expect(f.inspect().items[1]).toMatchObject({ status: "error", error: { code: "delivery_uncertain" } })
    expect(f.store.load(worker.taskId)?.revive_delivery_uncertain?.run_epoch).toBe(1)
    failureReceipt("terminal-before-ack", f.inspect())
  })

  test("#given lost acknowledgment but a live assigned worker #when a same-identity yield arrives #then only completion replaces uncertainty from its durable event", async () => {
    // given
    const f = deliveryFixture()
    const worker = await f.start()
    await f.settle(worker.taskId)
    await f.park(worker.taskId)
    f.followUp(async () => { throw new Error("fixture lost acknowledgment") })
    const failed = f.event("admission_failed")
    f.push("late-yield")
    await failed
    // when
    const accepted = f.yieldResults(worker.taskId, 1, [{ key: "late-yield", data: 42 }])
    const duplicate = f.yieldResults(worker.taskId, 1, [{ key: "late-yield", data: 42 }])
    const conflicting = f.yieldResults(worker.taskId, 1, [{ key: "late-yield", data: 99 }])
    // then
    expect(accepted).toMatchObject({ results: [{ status: "accepted" }] })
    expect(duplicate).toMatchObject({ results: [{ status: "duplicate" }] })
    expect(conflicting).toMatchObject({ results: [{ status: "refused", error: { code: "yield_conflict" } }] })
    expect(f.inspect().items[1]?.error?.code).toBe("delivery_uncertain")
    await f.settle(worker.taskId)
    expect(f.inspect().items[1]).toMatchObject({ status: "completed", data: 42 })
    expect(f.resumes).toHaveLength(1)
    failureReceipt("yield-after-ack-loss", { accepted, duplicate, conflicting, pool: f.inspect() })
  })

  test("#given a row-10 running record without delivery metadata #when reloaded #then uncertainty hashes the recorded launch message rather than a fabricated identity", async () => {
    // given
    const f = deliveryFixture({ mode: "fresh" })
    const worker = await f.start("legacy")
    const prompt = f.turns[0]?.spec.prompt
    if (prompt === undefined) throw new Error("missing launch prompt")
    f.manager.workpools.dispose()
    f.store.mutate(worker.taskId, record => ({ ...record, spawn_spec: { version: 1, cwd: f.root, prompt } }))
    const pools = createWorkpoolStore(f.store.stateDir)
    pools.mutate(f.pool.pool_id, pool => ({ ...pool, items: pool.items.map(item => { const { delivery: _delivery, ...legacy } = item; return legacy }) }))
    // when
    reconcileWorkpool({ pools, tasks: f.store }, f.pool.pool_id, () => false)
    // then
    expect(pools.load(f.pool.pool_id).items[0]).toMatchObject({ error: { code: "delivery_uncertain" }, delivery: { message_sha256: createHash("sha256").update(prompt).digest("hex") } })
    failureReceipt("legacy-message-digest", pools.load(f.pool.pool_id))
  })
}

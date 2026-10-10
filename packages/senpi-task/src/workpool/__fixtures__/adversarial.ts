import { expect, test } from "bun:test"
import { createTaskManager } from "../../manager/manager"
import { TaskConcurrency } from "../../manager/concurrency"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { WorkpoolError } from "../types"
import { createWorkpoolStore } from "../store"
import { bounded, deferred, fixture, poolInput } from "./admission"
import type { SpawnAdmission } from "../../manager/types"

const signal = () => AbortSignal.timeout(5000)
export function runAdversarialCases(): void {
  test("#given keep-alive reuse #when interrupted repeatedly #then epochs release once and stale yields cannot bind", async () => {
    // given
    const f = fixture()
    const pool = f.manager.workpools.create(f.caller, { ...poolInput, mode: "keep_alive" })
    let taskId: string | undefined
    // when / then
    for (let epoch = 0; epoch < 3; epoch += 1) {
      const dispatched = f.manager.workpools.waitForEvent(pool.pool_id, "dispatched", signal())
      f.manager.workpools.push(f.caller, pool.pool_id, [{ key: `k${epoch}`, input: epoch }])
      const event = await dispatched
      if (event.task_id === undefined) throw new Error("missing worker")
      taskId ??= event.task_id
      expect(event.task_id).toBe(taskId)
      expect(event.run_epoch).toBe(epoch)
      if (epoch > 0) {
        try { f.manager.workpools.yieldResults(taskId, 0, { op: "yield", results: [{ key: "k0", data: 1 }] }); throw new Error("expected stale yield") }
        catch (error) { if (!(error instanceof WorkpoolError)) throw error; expect(error.code).toBe("stale_assignment") }
      }
      const idle = f.manager.workpools.waitForEvent(pool.pool_id, "worker_idle", signal())
      expect((await f.manager.interruptTask(taskId)).kind).toBe("interrupted")
      await idle
      expect((await f.manager.interruptTask(taskId)).kind).toBe("noop")
      expect(f.concurrency.getRetainedKeyCounts().leases).toBe(0)
    }
    expect(f.starts).toHaveLength(1)
  })
  test("#given an assigned item after host loss #when the store reloads #then no uncertain worker prompt is replayed", async () => {
    // given
    const f = fixture()
    const pool = f.manager.workpools.create(f.caller, poolInput)
    const dispatched = f.manager.workpools.waitForEvent(pool.pool_id, "dispatched", signal())
    f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: 1 }])
    const event = await dispatched
    if (event.task_id === undefined) throw new Error("missing worker")
    const record = f.manager.get(event.task_id)
    if (record === undefined) throw new Error("missing record")
    f.manager.workpools.dispose()
    let starts = 0
    const runner = { start: async (): Promise<never> => { starts += 1; throw new Error("must not replay") } }
    const reloaded = createTaskManager({ store: f.store, runners: { "in-process": runner, process: runner }, cwd: f.root,
      planner: () => ({ kind: "resolved", plan: pool.worker_spec.plan }), config: OmoTaskSettingsSchema.parse({}) })
    try {
      // when / then
      expect((await reloaded.respawn(record)).ok).toBe(false)
      expect(createWorkpoolStore(f.store.stateDir).load(pool.pool_id).items[0]?.status).toBe("assigned")
      expect(starts).toBe(0)
    } finally { reloaded.workpools.dispose() }
  })
  test("#given shared persisted queues #when two engine owners race for one item #then the binding CAS dispatches once", async () => {
    // given
    const gate = deferred<SpawnAdmission>()
    const released = deferred<void>()
    class ObservedConcurrency extends TaskConcurrency {
      override releaseLease(taskId: string, epoch: number): void {
        super.releaseLease(taskId, epoch)
        if (taskId !== "st_00000001") released.resolve()
      }
    }
    const f = fixture({ config: { global_concurrency: 2, default_concurrency: 2 }, admit: () => gate.promise })
    const pool = f.manager.workpools.create(f.caller, poolInput)
    const first = f.manager.workpools.waitForEvent(pool.pool_id, "dispatched", signal())
    const granted = f.manager.workpools.waitForEvent(pool.pool_id, "granted", signal())
    const observed = new ObservedConcurrency({ global_concurrency: 1 })
    observed.tryAcquire("test/model", "st_00000001", 0)
    const runner = { start: async (): Promise<never> => { throw new Error("duplicate spawn") } }
    const other = createTaskManager({ store: f.store, concurrency: observed, runners: { "in-process": runner, process: runner }, cwd: f.root,
      planner: () => ({ kind: "resolved", plan: pool.worker_spec.plan }), config: OmoTaskSettingsSchema.parse({}) })
    try {
      const waiting = other.workpools.waitForEvent(pool.pool_id, "waiting", signal())
      // when
      f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: 1 }])
      await granted
      other.workpools.attach(f.caller)
      await waiting
      gate.resolve({ kind: "admitted" })
      await first
      const releaseObserved = bounded(released.promise)
      observed.releaseLease("st_00000001", 0)
      await releaseObserved
      // then
      expect(f.starts).toHaveLength(1)
      expect(f.store.list().records).toHaveLength(1)
      expect(observed.getRetainedKeyCounts().leases).toBe(0)
    } finally { other.workpools.dispose() }
  })
  test("#given pool and normal spawns #when residency observations race #then both share the existing session admission lease", async () => {
    // given
    const entered = deferred<void>()
    const resume = deferred<void>()
    const f = fixture({ config: { global_concurrency: 2, default_concurrency: 2, residency_max_children: 1 }, admit: async parent => {
      const result = await f.lifecycle.admitResident(parent)
      entered.resolve()
      await resume.promise
      return result.kind === "rejected" ? { kind: "rejected", message: result.error.message } : result
    } })
    const pool = f.manager.workpools.create(f.caller, poolInput)
    const dispatched = f.manager.workpools.waitForEvent(pool.pool_id, "dispatched", signal())
    const admissionEntered = bounded(entered.promise)
    f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: 1 }])
    await admissionEntered
    // when
    const normal = f.manager.start({ parent_session_id: f.caller.sessionId, depth: 1, prompt: "Normal task", category: "quick" })
    resume.resolve()
    await dispatched
    // then
    expect((await normal).kind).toBe("residency_denied")
    expect(f.starts).toHaveLength(1)
    expect(f.store.list().records).toHaveLength(1)
  })
  test("#given a one-shot worker #when keep-alive attempts reuse #then the policy refuses without another spawn or leaked lease", async () => {
    // given
    const f = fixture()
    f.manager.workpools.setSpawnPolicy(() => undefined)
    const pool = f.manager.workpools.create(f.caller, { ...poolInput, mode: "keep_alive", agent: { subagent_type: "plan-reviewer", prompt: "Review fixture" } })
    const dispatched = f.manager.workpools.waitForEvent(pool.pool_id, "dispatched", signal())
    f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: 1 }])
    const worker = await dispatched
    if (worker.task_id === undefined) throw new Error("missing worker")
    const idle = f.manager.workpools.waitForEvent(pool.pool_id, "worker_idle", signal())
    f.handles.get(worker.task_id)?.settle({ status: "completed", finalResponse: "done" })
    await idle
    const failed = f.manager.workpools.waitForEvent(pool.pool_id, "admission_failed", signal())
    // when
    f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "b", input: 2 }])
    // then
    expect((await failed).error?.code).toBe("worker_not_continuable")
    expect(f.starts).toHaveLength(1)
    expect(f.concurrency.getRetainedKeyCounts().leases).toBe(0)
    expect(f.manager.workpools.ownsTask(worker.task_id)).toBe(true)
    expect(f.starts[0]?.prompt).toBe(pool.worker_spec.start.prompt)
  })
}

import { expect, test } from "bun:test"
import { orderIdleWorkers } from "../dispatcher"
import { createWorkpoolStore } from "../store"
import { WorkpoolError } from "../types"
import { evidence, fixture, poolInput } from "./admission"

const failures: unknown[] = []
export function failureEvidence(name: string, data: unknown): void { failures.push({ name, data }); evidence("failure", failures) }
const record = failureEvidence
const signal = () => AbortSignal.timeout(5000)
export function runCapacityCases(): void {
  const cases = [
    { name: "global", config: { default_concurrency: 5, global_concurrency: 1 }, other: "other/model" },
    { name: "model", config: { default_concurrency: 5, global_concurrency: 0, model_concurrency: { "test/model": 1 } }, other: "test/model" },
    { name: "provider", config: { default_concurrency: 5, global_concurrency: 0, provider_concurrency: { test: 1 } }, other: "test/other" },
  ]
  for (const value of cases) test(`#given zero capacity and acquisition races #when ${value.name} cap is full #then another pool cannot over-admit`, async () => {
    // given
    const f = fixture({ config: value.config })
    f.concurrency.tryAcquire(value.other, "st_00000001", 0)
    const pool = f.manager.workpools.create(f.caller, poolInput)
    const waiting = f.manager.workpools.waitForEvent(pool.pool_id, "waiting", signal())
    const dispatched = f.manager.workpools.waitForEvent(pool.pool_id, "dispatched", signal())
    // when
    f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: null }])
    await waiting
    // then
    expect(f.starts).toEqual([])
    expect(f.concurrency.getRetainedKeyCounts().leases).toBe(1)
    f.concurrency.releaseLease("st_00000001", 0)
    await dispatched
    expect(f.starts).toHaveLength(1)
    expect(f.concurrency.getRetainedKeyCounts().leases).toBe(1)
    record(value.name, { events: f.events, retained: f.concurrency.getRetainedKeyCounts() })
  })
  test("#given zero capacity and acquisition races #when residency denies a granted item #then a typed error releases the lane", async () => {
    // given
    const f = fixture({ config: { global_concurrency: 2, default_concurrency: 2, residency_max_children: 1 } })
    const blocker = await f.manager.start({ parent_session_id: f.caller.sessionId, depth: 1, prompt: "Occupy residency", category: "quick" })
    expect(blocker.kind).toBe("started")
    const pool = f.manager.workpools.create(f.caller, poolInput)
    const failed = f.manager.workpools.waitForEvent(pool.pool_id, "admission_failed", signal())
    // when
    f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: null }])
    const event = await failed
    // then
    expect(event.error?.code).toBe("admission_refused")
    expect(f.starts).toHaveLength(1)
    expect(f.store.list().records).toHaveLength(1)
    expect(f.concurrency.getRetainedKeyCounts().leases).toBe(1)
    expect(f.manager.workpools.inspect(f.caller, pool.pool_id).items[0]?.error?.code).toBe("admission_refused")
    record("residency", { event, residents: f.store.list().records.length, lanes: f.concurrency.getRetainedKeyCounts() })
  })
  test("#given zero capacity and acquisition races #when two pools contend for one residency #then only one record is admitted", async () => {
    // given
    const f = fixture({ config: { global_concurrency: 2, default_concurrency: 2, residency_max_children: 1 } })
    const a = f.manager.workpools.create(f.caller, poolInput)
    const b = f.manager.workpools.create(f.caller, { ...poolInput, name: "second" })
    const dispatched = f.manager.workpools.waitForEvent(a.pool_id, "dispatched", signal())
    const failed = f.manager.workpools.waitForEvent(b.pool_id, "admission_failed", signal())
    // when
    f.manager.workpools.push(f.caller, a.pool_id, [{ key: "a", input: 1 }])
    f.manager.workpools.push(f.caller, b.pool_id, [{ key: "b", input: 2 }])
    const events = await Promise.all([dispatched, failed])
    // then
    expect(f.starts).toHaveLength(1)
    expect(f.store.list().records).toHaveLength(1)
    expect(f.concurrency.getRetainedKeyCounts().leases).toBe(1)
    record("residency-race", events)
  })
}

export function runModeCases(): void {
  for (const mode of ["fresh", "keep_alive"] as const) test(`#given zero capacity and acquisition races #when ${mode} workers are all busy #then queued input waits and each turn acquires once`, async () => {
    // given
    const f = fixture()
    const pool = f.manager.workpools.create(f.caller, { ...poolInput, mode })
    const first = f.manager.workpools.waitForEvent(pool.pool_id, "dispatched", signal())
    f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: 1 }])
    const initial = await first
    if (initial.task_id === undefined) throw new Error("missing worker")
    const second = f.manager.workpools.waitForEvent(pool.pool_id, "dispatched", signal())
    // when
    f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "b", input: 2 }])
    expect(f.manager.workpools.inspect(f.caller, pool.pool_id).items[1]?.status).toBe("queued")
    expect(f.starts).toHaveLength(1)
    f.handles.get(initial.task_id)?.settle({ status: "completed", finalResponse: "first" })
    const next = await second
    // then
    expect(f.starts).toHaveLength(mode === "fresh" ? 2 : 1)
    expect(next.run_epoch).toBe(mode === "fresh" ? 0 : 1)
    expect(next.task_id === initial.task_id).toBe(mode === "keep_alive")
    expect(f.concurrency.getRetainedKeyCounts().leases).toBe(1)
    if (next.task_id === undefined) throw new Error("missing next worker")
    const idle = f.manager.workpools.waitForEvent(pool.pool_id, "worker_idle", signal())
    f.handles.get(next.task_id)?.settle({ status: "completed", finalResponse: "second" })
    await idle
    expect(f.concurrency.getRetainedKeyCounts().leases).toBe(0)
    expect(f.manager.workpools.inspect(f.caller, pool.pool_id).items.map(item => item.binding?.run_epoch)).toEqual(mode === "fresh" ? [0, 0] : [0, 1])
    record(mode, { events: f.events, starts: f.starts.map(spec => spec.taskId) })
  })
  test("#given idle workers #when choosing reuse #then completed turns precede oldest idle time and task ID", () => {
    // given / when / then
    const worker = { run_epoch: 0, status: "idle" as const, completed_turns: 1, idle_since: 10 }
    expect(orderIdleWorkers([
      { ...worker, task_id: "st_00000003" }, { ...worker, task_id: "st_00000002" },
      { ...worker, task_id: "st_00000001", completed_turns: 2, idle_since: 0 },
      { ...worker, task_id: "st_00000004", idle_since: 5 },
      { ...worker, task_id: "st_00000005", completed_turns: 0, idle_since: 50 },
    ]).map(value => value.task_id)).toEqual(["st_00000005", "st_00000004", "st_00000002", "st_00000003", "st_00000001"])
  })
}

export function runReloadCases(): void {
  test("#given zero capacity and acquisition races #when reloading unassigned data #then IDs survive and foreign or malformed IDs are refused", () => {
    // given
    const f = fixture()
    const pool = f.manager.workpools.create(f.caller, poolInput)
    const receipt = f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: { b: 2, a: 1 } }])
    f.manager.workpools.dispose()
    // when
    const store = createWorkpoolStore(f.store.stateDir)
    // then
    expect(store.load(pool.pool_id).items[0]?.item_id).toBe(receipt.item_ids[0]?.item_id)
    const denials: string[] = []
    for (const invoke of [() => store.owned({ ...f.caller, sessionId: "root" }, pool.pool_id), () => store.load("st_00000001"), () => store.load("../../secret"), () => store.load(`wp_${"0".repeat(32)}`)]) {
      try { invoke(); throw new Error("expected refusal") } catch (error) { if (!(error instanceof WorkpoolError)) throw error; denials.push(error.code) }
    }
    expect(denials).toEqual(["scope_denied", "invalid_pool_id", "invalid_pool_id", "pool_not_found"])
    record("reload-and-ownership", { receipt, denials })
  })
}

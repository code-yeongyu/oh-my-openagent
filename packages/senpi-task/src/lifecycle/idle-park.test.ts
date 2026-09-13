import { afterEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { EventEmitter, once } from "node:events"
import { resolveContext } from "./context"
import { reclaimIdleResidents, startIdleResidentReclaimer } from "./residency"
import { cleanupProjects, fakeHandle, FakeRegistry, readEvents, seedRecord, settings, tempStore } from "./__fixtures__/lifecycle-fakes"
import { runTaskOutput } from "../tools/output/output"
import { configureSharedSubunitLogger } from "@oh-my-opencode/utils"
import { createTaskManager } from "../manager/manager"
import { FakeRunner } from "../manager/__fixtures__/manager-fakes"
import { parkRealSession } from "./__fixtures__/idle-park-session"

const NOW = 2_000_000
const OLD = new Date(NOW - settings().resident_idle_timeout_ms).toISOString()
afterEach(() => { configureSharedSubunitLogger(undefined); cleanupProjects() })

function evidence(name: string, data: unknown): void {
  const dir = process.env.IDLE_PARK_EVIDENCE_DIR
  if (dir) writeFileSync(`${dir}/${name}.json`, JSON.stringify(data, null, 2))
}

describe("idle suspension", () => {
  test("#given configured retention #when the exact updated_at boundary arrives #then no early park and one boundary park", async () => {
    const store = tempStore()
    const registry = new FakeRegistry()
    const id = "st_00000711"
    const config = { ...settings(), resident_idle_timeout_ms: 37 }
    seedRecord(store, { task_id: id, host_pid: process.pid, updated_at: new Date(1000).toISOString() })
    registry.add(fakeHandle(id, "rpc", []))
    let now = 1036
    const context = resolveContext({ store, registry, config, now: () => now })
    expect(await reclaimIdleResidents(context)).toEqual([])
    now = 1037
    expect(await reclaimIdleResidents(context)).toEqual([id])
    expect(store.load(id)?.residency_state).toBe("rpc_detached")
  })

  test("#given configured retention #when the reaper scheduler starts #then cadence equals TTL and remains unrefed", () => {
    const intervals: number[] = []
    let unrefs = 0
    let clears = 0
    const config = { ...settings(), resident_idle_timeout_ms: 37 }
    const stop = startIdleResidentReclaimer(resolveContext({ store: tempStore(), registry: new FakeRegistry(), config,
      idleReclaimerScheduler: { setInterval: (_tick, ms) => { intervals.push(ms); return { unref: () => { unrefs += 1 } } }, clearInterval: () => { clears += 1 } },
    }))
    stop()
    expect(intervals).toEqual([37])
    expect(unrefs).toBe(1)
    expect(clears).toBe(1)
  })

  test("#given a real restored session #when the injected scheduler parks it #then task_output retains the transcript", async () => {
    // given / when
    const result = await parkRealSession()
    // then
    expect(result.record?.residency_state).toBe("persisted_only")
    expect(result.resident).toBe(false)
    expect(result.transcriptAfter).toBe(result.transcriptBefore)
    expect(result.trace).toEqual(["abort", "dispose"])
    expect(result.output.kind).toBe("transcript")
    if (result.output.kind === "transcript") expect(result.output.transcript).toContain("REAL_SESSION_SENTINEL")
    evidence("real-session", result)
  })

  test("#given terminal residents #when swept #then parks in-process and rpc", async () => {
    // given
    const store = tempStore()
    const trace: string[] = []
    class Registry extends FakeRegistry {
      override forget(id: string): void { trace.push(`forget:${id}`); super.forget(id) }
    }
    const registry = new Registry()
    const cases = [
      { id: "st_00000101", kind: "in-process", mode: "in-process", parked: "persisted_only" },
      { id: "st_00000102", kind: "rpc", mode: "process", parked: "rpc_detached" },
    ] as const
    for (const item of cases) {
      seedRecord(store, { task_id: item.id, execution_mode: item.mode, host_pid: process.pid, updated_at: OLD })
      store.mutate(item.id, (record) => ({ ...record, final_response: "IDLE_PARK_SENTINEL", spawn_spec: { version: 1, cwd: store.stateDir, prompt: "fixture" } }))
      registry.add(fakeHandle(item.id, item.kind, trace))
    }
    const context = resolveContext({ store, registry, config: settings({ resume_children: false }), now: () => NOW })
    // when
    const parked = await reclaimIdleResidents(context)
    // then
    expect(parked).toEqual(cases.map((item) => item.id))
    for (const item of cases) {
      const record = store.load(item.id)
      expect(record?.residency_state).toBe(item.parked)
      expect(record?.host_pid).toBeUndefined()
      expect(record?.spawn_spec).toEqual({ version: 1, cwd: store.stateDir, prompt: "fixture" })
      expect(registry.get(item.id)).toBeUndefined()
      expect(readEvents(store, item.id).at(-1)).toBe("suspended")
      const output = await runTaskOutput({ manager: { get: (id) => store.load(id) ?? undefined, list: () => store.list().records.map((record) => ({ record })) }, stateDir: store.stateDir }, { task_id: item.id }, "parent-1")
      expect(output.details.kind).toBe("status")
      if (output.details.kind === "status") expect(output.details.snapshot.final_response).toBe("IDLE_PARK_SENTINEL")
    }
    expect(trace).toEqual(["forget:st_00000101", "abort:st_00000101", "dispose:st_00000101", "forget:st_00000102", "abort:st_00000102", "terminate:st_00000102", "dispose:st_00000102"])
    evidence("happy", { parked, trace, records: store.list().records })
  })

  test("#given protected residents and a teardown barrier #when sweeps race #then pending sends and foreign owners win", async () => {
    // given
    const store = tempStore()
    const registry = new FakeRegistry()
    const trace: string[] = []
    const manager = createTaskManager({
      store, config: settings(), cwd: store.stateDir,
      runners: { "in-process": new FakeRunner(), process: new FakeRunner() },
      planner: () => ({ kind: "resolved", plan: { model: "anthropic/claude" } }),
    })
    registry.tryClaimEviction = (id) => manager.tryClaimEviction?.(id) ?? false
    registry.releaseEviction = (id) => manager.releaseEviction?.(id)
    const protectedIds = ["st_00000201", "st_00000202", "st_00000203", "st_00000204"]
    for (const id of protectedIds) seedRecord(store, { task_id: id, host_pid: process.pid, updated_at: OLD })
    store.mutate(protectedIds[0], (r) => ({ ...r, host_pid: 999999 }))
    store.mutate(protectedIds[1], (r) => ({ ...r, status: "running" }))
    for (const id of protectedIds.slice(1)) registry.add(fakeHandle(id, "in-process", trace))
    registry.markPending(protectedIds[2])
    store.mutate(protectedIds[3], (r) => ({ ...r, updated_at: new Date(NOW).toISOString() }))
    const id = "st_00000205"
    seedRecord(store, { task_id: id, host_pid: process.pid, updated_at: OLD })
    const events = new EventEmitter()
    const entered = once(events, "abort", { signal: AbortSignal.timeout(5000) })
    const release = Promise.withResolvers<void>()
    const handle = fakeHandle(id, "in-process", trace)
    registry.add({ ...handle, abort: async () => { await handle.abort(); events.emit("abort"); await release.promise } })
    const context = resolveContext({ store, registry, config: settings(), now: () => NOW })
    // when: subscribed before the sweep enters teardown; no scheduler timing dependency.
    const first = reclaimIdleResidents(context)
    try {
      await entered
      expect(manager.tryBeginSend?.(id)).toBe(false)
      expect((await manager.sendToTask({ idOrName: id, message: "race" })).kind).toBe("not_continuable")
      expect(await reclaimIdleResidents(context)).toEqual([])
    } finally { release.resolve() }
    const parked = await first
    // then
    expect(parked).toEqual([id])
    expect(trace).toEqual([`abort:${id}`, `dispose:${id}`])
    expect(manager.isEvicting?.(id)).toBe(false)
    for (const protectedId of protectedIds) expect(store.load(protectedId)?.residency_state).toBe("resident")
    evidence("failure", { parked, trace, protectedIds, records: store.list().records })
  })

  test("#given a stale candidate list #when state changes before teardown #then fresh running and pending sends are protected", async () => {
    // given
    const store = tempStore()
    const registry = new FakeRegistry()
    const trace: string[] = []
    const ids = ["st_00000301", "st_00000302"]
    for (const id of ids) { seedRecord(store, { task_id: id, host_pid: process.pid, updated_at: OLD }); registry.add(fakeHandle(id, "in-process", trace)) }
    const context = resolveContext({ store: { ...store, list: () => {
      const snapshot = store.list()
      store.mutate(ids[0], (r) => ({ ...r, status: "running" }))
      registry.markPending(ids[1])
      return snapshot
    } }, registry, config: settings(), now: () => NOW })
    // when / then
    expect(await reclaimIdleResidents(context)).toEqual([])
    expect(trace).toEqual([])
  })

  test("#given foreign metadata with a locally owned handle #when idle #then the established ownership exception parks it", async () => {
    // given
    const store = tempStore()
    const registry = new FakeRegistry()
    seedRecord(store, { task_id: "st_00000401", host_pid: 999999, updated_at: OLD })
    registry.add(fakeHandle("st_00000401", "in-process", []))
    // when / then
    expect(await reclaimIdleResidents(resolveContext({ store, registry, config: settings(), now: () => NOW }))).toEqual(["st_00000401"])
    expect(store.load("st_00000401")?.residency_state).toBe("persisted_only")
  })

  test("#given dispose failure #when idle sweeps repeat #then no successful park is reported", async () => {
    // given
    const store = tempStore()
    const registry = new FakeRegistry()
    const trace: string[] = []
    const failures: unknown[] = []
    configureSharedSubunitLogger((_message, data) => failures.push(data))
    seedRecord(store, { task_id: "st_00000501", host_pid: process.pid, updated_at: OLD })
    registry.add(fakeHandle("st_00000501", "in-process", trace, { disposeRejects: true }))
    const context = resolveContext({ store, registry, config: settings(), now: () => NOW })
    // when / then
    expect(await reclaimIdleResidents(context)).toEqual([])
    expect(await reclaimIdleResidents(context)).toEqual([])
    expect(store.load("st_00000501")?.residency_state).toBe("resident")
    expect(readEvents(store, "st_00000501")).not.toContain("suspended")
    expect(trace).toEqual(["abort:st_00000501", "dispose:st_00000501"])
    expect(registry.isEvicting("st_00000501")).toBe(false)
    expect(failures).toEqual([{ taskId: "st_00000501", error: "dispose exploded" }])
    evidence("dispose-failure", { trace, failures, record: store.load("st_00000501") })
  })

  test("#given deliberately stopped residents #when idle #then they remain irreversibly destroyed", async () => {
    // given
    const store = tempStore()
    const registry = new FakeRegistry()
    for (const [index, status] of (["cancelled", "lost", "error"] as const).entries()) {
      const id = `st_0000060${index}`
      seedRecord(store, { task_id: id, status, killed: status === "error", host_pid: process.pid, updated_at: OLD })
      registry.add(fakeHandle(id, "in-process", []))
    }
    // when
    await reclaimIdleResidents(resolveContext({ store, registry, config: settings(), now: () => NOW }))
    // then
    for (const record of store.list().records) {
      expect(record.residency_state).toBe("disposed")
      expect(readEvents(store, record.task_id).at(-1)).toBe("destroyed")
    }
  })
})

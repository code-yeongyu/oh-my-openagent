import { afterEach, describe, expect, test } from "bun:test"
import { EventEmitter, once } from "node:events"

import type { TaskRecordStore } from "../store"
import { createTaskLifecycle } from "./create"
import { cleanupProjects, fakeHandle, FakeRegistry, seedRecord, settings, tempStore } from "./__fixtures__/lifecycle-fakes"
import { NO_HOST_ENDPOINT } from "./host-session"
import type { ResidentHandle } from "./port"
import type { TeardownStep } from "./teardown-budget"

afterEach(cleanupProjects)

class SessionRegistry extends FakeRegistry {
  ownsRecord(record: { readonly parent_session_id: string }): boolean {
    return record.parent_session_id === "parent-1"
  }
}

const IDLE_MS = settings().resident_idle_timeout_ms
const STUCK = "st_000000a1"
const HEALTHY = "st_000000b1"

function stuckRpcHandle(taskId: string, calls: string[]): ResidentHandle {
  const never = () => new Promise<void>(() => undefined)
  return {
    task_id: taskId,
    kind: "rpc",
    pid: 999_999_999,
    abort: () => { calls.push(`abort:${taskId}`); return never() },
    terminate: () => { calls.push(`terminate:${taskId}`); return never() },
    dispose: () => { calls.push(`dispose:${taskId}`); return never() },
  }
}

// Every teardown step budget expires only when the test says so: no wall-clock waits.
function manualDeadlines() {
  const waiting: { step: TeardownStep; expire: () => void }[] = []
  const arrived = new EventEmitter()
  return {
    deadline: (step: TeardownStep) => new Promise<void>((resolve) => {
      waiting.push({ step, expire: resolve })
      arrived.emit("armed")
    }),
    armed: () => once(arrived, "armed", { signal: AbortSignal.timeout(3_000) }),
    expireAll: () => { for (const entry of waiting.splice(0)) entry.expire() },
    pendingSteps: () => waiting.map((entry) => entry.step),
  }
}

async function expireEachStep(deadlines: ReturnType<typeof manualDeadlines>, steps: number): Promise<void> {
  for (let step = 0; step < steps; step += 1) {
    if (deadlines.pendingSteps().length === 0) await deadlines.armed()
    deadlines.expireAll()
  }
}

function watchEvents(store: TaskRecordStore) {
  const events = new EventEmitter()
  const watched: TaskRecordStore = {
    ...store,
    appendEvent: (taskId, event) => {
      const path = store.appendEvent(taskId, event)
      events.emit(`${event.type}:${taskId}`)
      return path
    },
  }
  const next = (type: string, taskId: string) => once(events, `${type}:${taskId}`, { signal: AbortSignal.timeout(3_000) })
  return { watched, next }
}

function idleLifecycle(store: TaskRecordStore, registry: FakeRegistry, deadlines: ReturnType<typeof manualDeadlines>) {
  let tick: () => void = () => { throw new Error("idle reclaimer was not scheduled") }
  const lifecycle = createTaskLifecycle({
    hostEndpoint: NO_HOST_ENDPOINT,
    store,
    registry,
    config: settings({ residency_max_children: 42 }),
    now: () => 1_000_000 + IDLE_MS + 1,
    teardownStepDeadline: deadlines.deadline,
    idleReclaimerScheduler: { setInterval: (callback) => { tick = callback; return {} }, clearInterval: () => undefined },
  })
  return { lifecycle, tick: () => tick() }
}

function seedIdle(store: TaskRecordStore, taskId: string, status: "completed" | "error", executionMode = "in-process") {
  seedRecord(store, { task_id: taskId, status, residency_state: "resident", updated_at: new Date(1_000_000).toISOString(), host_pid: process.pid, execution_mode: executionMode })
}

describe("idle resident sweep with a child that never exits (omo#9785)", () => {
  test("#given a stuck rpc resident before a healthy one #when the sweep runs #then the healthy one is parked without waiting on the stuck one", async () => {
    // given
    const store = tempStore()
    const { watched, next } = watchEvents(store)
    const registry = new FakeRegistry()
    const calls: string[] = []
    seedIdle(store, STUCK, "completed", "process")
    seedIdle(store, HEALTHY, "completed")
    registry.add(stuckRpcHandle(STUCK, calls))
    registry.add(fakeHandle(HEALTHY, "in-process", calls))
    const deadlines = manualDeadlines()
    const { lifecycle } = idleLifecycle(watched, registry, deadlines)

    // when
    const healthyParked = next("suspended", HEALTHY)
    const sweep = lifecycle.reclaimIdleResidents?.()
    await healthyParked

    // then
    expect(store.load(HEALTHY)?.residency_state).toBe("persisted_only")
    expect(store.load(STUCK)?.residency_state).toBe("resident")
    await expireEachStep(deadlines, 3)
    expect(await sweep).toEqual([STUCK, HEALTHY])
    lifecycle.dispose?.()
  })

  test("#given a stuck rpc resident #when every step budget expires #then it is terminated, parked as rpc_detached, and the sweep settles", async () => {
    // given
    const store = tempStore()
    const { watched, next } = watchEvents(store)
    const registry = new FakeRegistry()
    const calls: string[] = []
    seedIdle(store, STUCK, "completed", "process")
    registry.add(stuckRpcHandle(STUCK, calls))
    const deadlines = manualDeadlines()
    const { lifecycle } = idleLifecycle(watched, registry, deadlines)

    // when
    const parked = next("suspended", STUCK)
    const sweep = lifecycle.reclaimIdleResidents?.()
    await expireEachStep(deadlines, 3)
    await parked

    // then
    expect(await sweep).toEqual([STUCK])
    expect(calls).toEqual([`abort:${STUCK}`, `terminate:${STUCK}`, `dispose:${STUCK}`])
    expect(store.load(STUCK)?.residency_state).toBe("rpc_detached")
    expect(registry.get(STUCK)).toBeUndefined()
    lifecycle.dispose?.()
  })

  test("#given an errored in-process resident past the idle timeout #when the sweep runs #then it is parked like a completed one", async () => {
    // given
    const store = tempStore()
    const registry = new FakeRegistry()
    const handle = fakeHandle(HEALTHY, "in-process", [])
    seedIdle(store, HEALTHY, "error")
    registry.add(handle)
    const { lifecycle } = idleLifecycle(store, registry, manualDeadlines())

    // when
    const reclaimed = await lifecycle.reclaimIdleResidents?.()

    // then
    expect(reclaimed).toEqual([HEALTHY])
    expect(handle.disposed()).toBe(true)
    expect(store.load(HEALTHY)?.residency_state).toBe("persisted_only")
    lifecycle.dispose?.()
  })
  test("#given an errored resident whose session never opened (no handle) #when the sweep runs #then its record is parked", async () => {
    // given
    const store = tempStore()
    seedIdle(store, STUCK, "error", "process")
    const { lifecycle } = idleLifecycle(store, new SessionRegistry(), manualDeadlines())

    // when
    const reclaimed = await lifecycle.reclaimIdleResidents?.()

    // then
    expect(reclaimed).toEqual([STUCK])
    expect(store.load(STUCK)?.residency_state).toBe("rpc_detached")
    lifecycle.dispose?.()
  })
  test("#given a handle-less finished child of a sibling session in this process #when this session's engine sweeps #then it is left alone", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: STUCK, status: "completed", residency_state: "resident", updated_at: new Date(1_000_000).toISOString(), host_pid: process.pid, parent_session_id: "parent-2" })
    const { lifecycle } = idleLifecycle(store, new SessionRegistry(), manualDeadlines())

    // when
    const reclaimed = await lifecycle.reclaimIdleResidents?.()

    // then
    expect(reclaimed).toEqual([])
    expect(store.load(STUCK)?.residency_state).toBe("resident")
    expect(store.load(STUCK)?.host_pid).toBe(process.pid)
    lifecycle.dispose?.()
  })
})

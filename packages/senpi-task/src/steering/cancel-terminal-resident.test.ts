import { afterEach, describe, expect, test } from "bun:test"

import { createTaskLifecycle } from "../lifecycle/create"
import { cleanupProjects, fakeHandle, FakeRegistry, seedRecord, settings, tempStore } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { NO_HOST_ENDPOINT } from "../lifecycle/host-session"
import type { TaskRecordStore } from "../store"
import { runTaskCancel } from "../tools/control/cancel"
import { createSteeringEngine } from "./engine"
import type { CancelOptions, SteeringPort } from "./types"

afterEach(cleanupProjects)

// The session this engine serves; seedRecord's default parent session.
class SessionRegistry extends FakeRegistry {
  ownsRecord(record: { readonly parent_session_id: string }): boolean {
    return record.parent_session_id === "parent-1"
  }
}

const TASK = "st_00009785"

function cancelSurface(store: TaskRecordStore, registry: FakeRegistry, options?: CancelOptions) {
  const lifecycle = createTaskLifecycle({ hostEndpoint: NO_HOST_ENDPOINT, store, registry, config: settings() })
  const port: SteeringPort = {
    store,
    liveHandle: () => undefined,
    reserveForRevive: () => ({ ok: true, commit: () => undefined, release: () => undefined }),
    reviveDetached: async () => ({ ok: false, reason: "not used" }),
    dequeuePending: () => false,
    destruction: lifecycle,
    runStatsSnapshot: () => undefined,
    now: () => Date.parse("2026-10-08T00:00:00.000Z"),
  }
  const engine = createSteeringEngine(port)
  const manager = { cancelTask: engine.cancelTask, get: (taskId: string) => store.load(taskId) ?? undefined }
  return { lifecycle, engine, cancel: () => runTaskCancel(manager, { task_id: TASK }), cancelWith: () => engine.cancelTask(TASK, undefined, options) }
}

describe("task_cancel on a finished child that is still resident (omo#9785)", () => {
  test("#given an errored child still resident here #when cancelled #then its child is stopped and the record parks, readable and revivable", async () => {
    // given
    const store = tempStore()
    const registry = new FakeRegistry()
    const calls: string[] = []
    const handle = fakeHandle(TASK, "in-process", calls)
    seedRecord(store, { task_id: TASK, status: "error", residency_state: "resident", host_pid: process.pid })
    registry.add(handle)
    const { lifecycle, cancel } = cancelSurface(store, registry)

    // when
    const result = await cancel()

    // then
    expect(result.details).toEqual({ kind: "released", task_id: TASK, status: "error" })
    expect(calls).toEqual([`abort:${TASK}`, `dispose:${TASK}`])
    expect(registry.get(TASK)).toBeUndefined()
    expect(store.load(TASK)?.status).toBe("error")
    expect(store.load(TASK)?.residency_state).toBe("persisted_only")
    lifecycle.dispose?.()
  })

  test("#given a released child #when cancelled again #then nothing changes and the finished status is reported", async () => {
    // given
    const store = tempStore()
    const registry = new FakeRegistry()
    seedRecord(store, { task_id: TASK, status: "completed", residency_state: "resident", host_pid: process.pid })
    registry.add(fakeHandle(TASK, "in-process", []))
    const { lifecycle, cancel } = cancelSurface(store, registry)
    await cancel()

    // when
    const again = await cancel()

    // then
    expect(again.details).toMatchObject({ kind: "noop", task_id: TASK, status: "completed" })
    expect(store.load(TASK)?.residency_state).toBe("persisted_only")
    lifecycle.dispose?.()
  })

  test("#given a finished child resident in another process #when cancelled here #then it is left alone", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: TASK, status: "completed", residency_state: "resident", host_pid: process.pid + 1 })
    const { lifecycle, cancel } = cancelSurface(store, new FakeRegistry())

    // when
    const result = await cancel()

    // then
    expect(result.details).toMatchObject({ kind: "noop", status: "completed" })
    expect(store.load(TASK)?.residency_state).toBe("resident")
    lifecycle.dispose?.()
  })
  test("#given a cancelled resident whose destruction is still in flight #when cancelled again #then it is not released or torn down a second time", async () => {
    // given
    const store = tempStore()
    const registry = new FakeRegistry()
    const calls: string[] = []
    seedRecord(store, { task_id: TASK, status: "cancelled", residency_state: "resident", host_pid: process.pid })
    registry.add(fakeHandle(TASK, "rpc", calls))
    const { lifecycle, cancel } = cancelSurface(store, registry)

    // when
    const result = await cancel()

    // then
    expect(result.details).toMatchObject({ kind: "noop", status: "cancelled" })
    expect(calls).toEqual([])
    expect(store.load(TASK)?.residency_state).toBe("resident")
    lifecycle.dispose?.()
  })

  test("#given a finished resident and a cancel that skips abort (DAG) #when cancelled #then it is left resident", async () => {
    // given
    const store = tempStore()
    const registry = new FakeRegistry()
    const calls: string[] = []
    seedRecord(store, { task_id: TASK, status: "completed", residency_state: "resident", host_pid: process.pid })
    registry.add(fakeHandle(TASK, "in-process", calls))
    const { lifecycle, cancelWith } = cancelSurface(store, registry, { abort: "skip" })

    // when
    const outcome = await cancelWith()

    // then
    expect(outcome).toMatchObject({ kind: "noop", status: "completed" })
    expect(calls).toEqual([])
    lifecycle.dispose?.()
  })
  test("#given an errored resident whose session never opened (no live handle) #when cancelled #then only its record is parked", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: TASK, status: "error", residency_state: "resident", host_pid: process.pid, execution_mode: "process" })
    const { lifecycle, cancel } = cancelSurface(store, new SessionRegistry())

    // when
    const result = await cancel()

    // then
    expect(result.details).toEqual({ kind: "released", task_id: TASK, status: "error" })
    expect(store.load(TASK)?.residency_state).toBe("rpc_detached")
    lifecycle.dispose?.()
  })

  test("#given a handle-less finished resident whose child pid is still alive #when cancelled #then it is left for reconciliation", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: TASK, status: "error", residency_state: "resident", host_pid: process.pid, execution_mode: "process", pid: process.pid })
    const { lifecycle, cancel } = cancelSurface(store, new SessionRegistry())

    // when
    const result = await cancel()

    // then
    expect(result.details).toMatchObject({ kind: "noop", status: "error" })
    expect(store.load(TASK)?.residency_state).toBe("resident")
    lifecycle.dispose?.()
  })
  test("#given a handle-less finished child of a sibling session in this process #when cancelled here #then it is left to its own session", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: TASK, status: "completed", residency_state: "resident", host_pid: process.pid, parent_session_id: "parent-2" })
    const { lifecycle, cancel } = cancelSurface(store, new SessionRegistry())

    // when
    const result = await cancel()

    // then
    expect(result.details).toMatchObject({ kind: "noop", status: "completed" })
    expect(store.load(TASK)?.residency_state).toBe("resident")
    lifecycle.dispose?.()
  })

  test("#given an interrupted resident whose resume holds its slot before its handle exists #when cancelled #then it is not released", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: TASK, status: "interrupted", residency_state: "resident", host_pid: process.pid })
    const { lifecycle, cancel } = cancelSurface(store, new SessionRegistry())

    // when
    const result = await cancel()

    // then
    expect(result.details).toMatchObject({ kind: "noop", status: "interrupted" })
    expect(store.load(TASK)?.residency_state).toBe("resident")
    lifecycle.dispose?.()
  })
})

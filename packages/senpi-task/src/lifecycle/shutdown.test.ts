import { afterEach, describe, expect, test } from "bun:test"

import { createTaskLifecycle } from "./create"
import {
  cleanupProjects,
  fakeHandle,
  FakeRegistry,
  readEvents,
  seedRecord,
  settings,
  tempStore,
  type CallLog,
} from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

const HOST = process.pid
const FOREIGN_PID = 9_999_999

// A registry that records forget() into the same call log as the fake handles, so tests can prove
// ownership is dropped BEFORE abort settles the turn (the todo-7 outcome guard depends on it).
class OrderRegistry extends FakeRegistry {
  readonly #order: CallLog

  constructor(order: CallLog) {
    super()
    this.#order = order
  }

  override forget(taskId: string): void {
    this.#order.push(`forget:${taskId}`)
    super.forget(taskId)
  }
}

describe("suspendOnSessionShutdown", () => {
  test("#given an in-process running resident #when its session shuts down #then it suspends persisted_only with forget before abort and run_epoch unchanged", async () => {
    // given
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_000000f0",
      status: "running",
      residency_state: "resident",
      execution_mode: "in-process",
      host_pid: HOST,
      run_epoch: 3,
    })
    const order: CallLog = []
    const registry = new OrderRegistry(order)
    registry.add(fakeHandle("st_000000f0", "in-process", order))
    const lifecycle = createTaskLifecycle({ store, registry, config: settings() })

    // when
    const summary = await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })

    // then
    const record = store.load("st_000000f0")
    expect(record?.status).toBe("running")
    expect(record?.residency_state).toBe("persisted_only")
    expect(record?.host_pid).toBeUndefined()
    expect(record?.notification.run_epoch).toBe(3)
    expect(order.indexOf("forget:st_000000f0")).toBeLessThan(order.indexOf("abort:st_000000f0"))
    expect(order.indexOf("abort:st_000000f0")).toBeLessThan(order.indexOf("dispose:st_000000f0"))
    expect(readEvents(store, "st_000000f0").at(-1)).toBe("suspended")
    expect(summary).toEqual({ suspended_in_process: 1, suspended_rpc: 0, suspended_pending: 0, disposed: 0, failures: [] })
  })

  test("#given an rpc running resident #when its session shuts down #then it suspends rpc_detached retaining pid and clearing host_pid", async () => {
    // given
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_000000f1",
      status: "running",
      residency_state: "resident",
      execution_mode: "process",
      host_pid: HOST,
      pid: 55,
    })
    const order: CallLog = []
    const registry = new OrderRegistry(order)
    registry.add(fakeHandle("st_000000f1", "rpc", order, { pid: 55 }))
    const lifecycle = createTaskLifecycle({ store, registry, config: settings() })

    // when
    const summary = await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "reload" })

    // then
    const record = store.load("st_000000f1")
    expect(record?.status).toBe("running")
    expect(record?.residency_state).toBe("rpc_detached")
    expect(record?.pid).toBe(55)
    expect(record?.host_pid).toBeUndefined()
    expect(order.indexOf("abort:st_000000f1")).toBeLessThan(order.indexOf("terminate:st_000000f1"))
    expect(order.indexOf("terminate:st_000000f1")).toBeLessThan(order.indexOf("dispose:st_000000f1"))
    expect(readEvents(store, "st_000000f1").at(-1)).toBe("suspended")
    expect(summary).toEqual({ suspended_in_process: 0, suspended_rpc: 1, suspended_pending: 0, disposed: 0, failures: [] })
  })

  test("#given a resident of a different parent session #when this session shuts down #then it is untouched", async () => {
    // given
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_000000f2",
      parent_session_id: "session-b",
      status: "running",
      residency_state: "resident",
      execution_mode: "in-process",
      host_pid: HOST,
    })
    const order: CallLog = []
    const registry = new OrderRegistry(order)
    registry.add(fakeHandle("st_000000f2", "in-process", order))
    const lifecycle = createTaskLifecycle({ store, registry, config: settings() })

    // when
    const summary = await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })

    // then
    const record = store.load("st_000000f2")
    expect(record?.residency_state).toBe("resident")
    expect(record?.host_pid).toBe(HOST)
    expect(registry.get("st_000000f2")).toBeDefined()
    expect(registry.forgotten).toEqual([])
    expect(readEvents(store, "st_000000f2")).toEqual([])
    expect(summary).toEqual({ suspended_in_process: 0, suspended_rpc: 0, suspended_pending: 0, disposed: 0, failures: [] })
  })

  test("#given a resident owned by a foreign host pid #when this session shuts down #then it is untouched", async () => {
    // given
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_000000f3",
      status: "running",
      residency_state: "resident",
      execution_mode: "in-process",
      host_pid: FOREIGN_PID,
    })
    const order: CallLog = []
    const registry = new OrderRegistry(order)
    registry.add(fakeHandle("st_000000f3", "in-process", order))
    const lifecycle = createTaskLifecycle({ store, registry, config: settings() })

    // when
    const summary = await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })

    // then
    const record = store.load("st_000000f3")
    expect(record?.residency_state).toBe("resident")
    expect(record?.host_pid).toBe(FOREIGN_PID)
    expect(registry.forgotten).toEqual([])
    expect(readEvents(store, "st_000000f3")).toEqual([])
    expect(summary).toEqual({ suspended_in_process: 0, suspended_rpc: 0, suspended_pending: 0, disposed: 0, failures: [] })
  })

  test("#given a cancelled resident #when its session shuts down #then it is disposed through the cancel family, not suspended", async () => {
    // given
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_000000f4",
      status: "cancelled",
      residency_state: "resident",
      execution_mode: "in-process",
      host_pid: HOST,
    })
    const order: CallLog = []
    const registry = new OrderRegistry(order)
    registry.add(fakeHandle("st_000000f4", "in-process", order))
    const lifecycle = createTaskLifecycle({ store, registry, config: settings() })

    // when
    const summary = await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })

    // then
    const record = store.load("st_000000f4")
    expect(record?.status).toBe("cancelled")
    expect(record?.residency_state).toBe("disposed")
    expect(registry.forgotten).toEqual(["st_000000f4"])
    expect(readEvents(store, "st_000000f4").at(-1)).toBe("destroyed")
    expect(readEvents(store, "st_000000f4")).not.toContain("suspended")
    expect(summary).toEqual({ suspended_in_process: 0, suspended_rpc: 0, suspended_pending: 0, disposed: 1, failures: [] })
  })

  test("#given a completed resident #when its session shuts down #then it suspends persisted_only preserving the completed status", async () => {
    // given
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_000000f5",
      status: "completed",
      residency_state: "resident",
      execution_mode: "in-process",
      host_pid: HOST,
    })
    const order: CallLog = []
    const registry = new OrderRegistry(order)
    registry.add(fakeHandle("st_000000f5", "in-process", order))
    const lifecycle = createTaskLifecycle({ store, registry, config: settings() })

    // when
    const summary = await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })

    // then
    const record = store.load("st_000000f5")
    expect(record?.status).toBe("completed")
    expect(record?.residency_state).toBe("persisted_only")
    expect(record?.host_pid).toBeUndefined()
    expect(readEvents(store, "st_000000f5").at(-1)).toBe("suspended")
    expect(summary).toEqual({ suspended_in_process: 1, suspended_rpc: 0, suspended_pending: 0, disposed: 0, failures: [] })
  })

  test("#given a pending record of this session with no handle #when its session shuts down #then it is dequeued and suspended with host_pid cleared and run_epoch unchanged", async () => {
    // given
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_000000f6",
      status: "pending",
      residency_state: "resident",
      execution_mode: "in-process",
      host_pid: HOST,
      run_epoch: 2,
    })
    const dequeued: string[] = []
    const lifecycle = createTaskLifecycle({
      store,
      registry: new FakeRegistry(),
      config: settings(),
      dequeuePending: (taskId) => dequeued.push(taskId),
    })

    // when
    const summary = await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })

    // then
    const record = store.load("st_000000f6")
    expect(record?.status).toBe("pending")
    expect(record?.residency_state).toBe("persisted_only")
    expect(record?.host_pid).toBeUndefined()
    expect(record?.notification.run_epoch).toBe(2)
    expect(dequeued).toEqual(["st_000000f6"])
    expect(readEvents(store, "st_000000f6").at(-1)).toBe("suspended")
    expect(summary).toEqual({ suspended_in_process: 0, suspended_rpc: 0, suspended_pending: 1, disposed: 0, failures: [] })
  })

  test("#given a pending record of another session #when this session shuts down #then it is untouched and never dequeued", async () => {
    // given
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_000000f7",
      parent_session_id: "session-b",
      status: "pending",
      residency_state: "resident",
      execution_mode: "in-process",
      host_pid: HOST,
    })
    const dequeued: string[] = []
    const lifecycle = createTaskLifecycle({
      store,
      registry: new FakeRegistry(),
      config: settings(),
      dequeuePending: (taskId) => dequeued.push(taskId),
    })

    // when
    const summary = await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })

    // then
    const record = store.load("st_000000f7")
    expect(record?.status).toBe("pending")
    expect(record?.residency_state).toBe("resident")
    expect(record?.host_pid).toBe(HOST)
    expect(dequeued).toEqual([])
    expect(readEvents(store, "st_000000f7")).toEqual([])
    expect(summary).toEqual({ suspended_in_process: 0, suspended_rpc: 0, suspended_pending: 0, disposed: 0, failures: [] })
  })

  test("#given a killed resident #when its session shuts down #then it is disposed with a destroyed event, never persisted_only", async () => {
    // given
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_000000f8",
      status: "error",
      residency_state: "resident",
      execution_mode: "in-process",
      host_pid: HOST,
      killed: true,
    })
    const order: CallLog = []
    const registry = new OrderRegistry(order)
    registry.add(fakeHandle("st_000000f8", "in-process", order))
    const lifecycle = createTaskLifecycle({ store, registry, config: settings() })

    // when
    const summary = await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })

    // then
    const record = store.load("st_000000f8")
    expect(record?.status).toBe("error")
    expect(record?.killed).toBe(true)
    expect(record?.residency_state).toBe("disposed")
    expect(readEvents(store, "st_000000f8").at(-1)).toBe("destroyed")
    expect(readEvents(store, "st_000000f8")).not.toContain("suspended")
    expect(summary).toEqual({ suspended_in_process: 0, suspended_rpc: 0, suspended_pending: 0, disposed: 1, failures: [] })
  })

  test("#given resume_children false #when the session shuts down #then the legacy dispose path runs and pending records stay untouched", async () => {
    // given
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_000000f9",
      status: "running",
      residency_state: "resident",
      execution_mode: "in-process",
      host_pid: HOST,
    })
    seedRecord(store, {
      task_id: "st_000000fa",
      status: "pending",
      residency_state: "resident",
      execution_mode: "in-process",
      host_pid: HOST,
    })
    const dequeued: string[] = []
    const order: CallLog = []
    const registry = new OrderRegistry(order)
    registry.add(fakeHandle("st_000000f9", "in-process", order))
    const lifecycle = createTaskLifecycle({
      store,
      registry,
      config: settings({ resume_children: false }),
      dequeuePending: (taskId) => dequeued.push(taskId),
    })

    // when
    const summary = await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })

    // then
    const resident = store.load("st_000000f9")
    expect(resident?.residency_state).toBe("disposed")
    expect(readEvents(store, "st_000000f9").at(-1)).toBe("destroyed")
    expect(readEvents(store, "st_000000f9")).not.toContain("suspended")
    expect(registry.forgotten).toEqual(["st_000000f9"])
    const pending = store.load("st_000000fa")
    expect(pending?.status).toBe("pending")
    expect(pending?.residency_state).toBe("resident")
    expect(pending?.host_pid).toBe(HOST)
    expect(dequeued).toEqual([])
    expect(readEvents(store, "st_000000fa")).toEqual([])
    expect(summary).toEqual({ suspended_in_process: 0, suspended_rpc: 0, suspended_pending: 0, disposed: 1, failures: [] })
  })

  test("#given one child whose dispose throws #when the session shuts down #then the other child still suspends and the failure is reported", async () => {
    // given
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_000000fb",
      status: "running",
      residency_state: "resident",
      execution_mode: "in-process",
      host_pid: HOST,
    })
    seedRecord(store, {
      task_id: "st_000000fc",
      status: "running",
      residency_state: "resident",
      execution_mode: "in-process",
      host_pid: HOST,
    })
    const order: CallLog = []
    const registry = new OrderRegistry(order)
    registry.add(fakeHandle("st_000000fb", "in-process", order, { disposeRejects: true }))
    registry.add(fakeHandle("st_000000fc", "in-process", order))
    const lifecycle = createTaskLifecycle({ store, registry, config: settings() })

    // when
    const summary = await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })

    // then
    expect(store.load("st_000000fb")?.residency_state).toBe("resident")
    expect(readEvents(store, "st_000000fb")).toEqual([])
    expect(store.load("st_000000fc")?.residency_state).toBe("persisted_only")
    expect(readEvents(store, "st_000000fc").at(-1)).toBe("suspended")
    expect(summary.suspended_in_process).toBe(1)
    expect(summary.failures).toHaveLength(1)
    expect(summary.failures[0]?.task_id).toBe("st_000000fb")
    expect(summary.failures[0]?.error).toContain("dispose exploded")
  })

  test("#given a child whose abort rejects #when the session shuts down #then suspension continues and no failure is recorded", async () => {
    // given
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_000000fd",
      status: "running",
      residency_state: "resident",
      execution_mode: "in-process",
      host_pid: HOST,
    })
    const order: CallLog = []
    const registry = new OrderRegistry(order)
    const handle = fakeHandle("st_000000fd", "in-process", order, { abortRejects: true })
    registry.add(handle)
    const lifecycle = createTaskLifecycle({ store, registry, config: settings() })

    // when
    const summary = await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })

    // then
    expect(handle.disposed()).toBe(true)
    const record = store.load("st_000000fd")
    expect(record?.residency_state).toBe("persisted_only")
    expect(readEvents(store, "st_000000fd").at(-1)).toBe("suspended")
    expect(summary).toEqual({ suspended_in_process: 1, suspended_rpc: 0, suspended_pending: 0, disposed: 0, failures: [] })
  })

  test("#given no children at all #when the session shuts down #then the summary is all zeros without throwing", async () => {
    // given
    const store = tempStore()
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings() })

    // when
    const summary = await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })

    // then
    expect(summary).toEqual({ suspended_in_process: 0, suspended_rpc: 0, suspended_pending: 0, disposed: 0, failures: [] })
  })
})

import { afterEach, describe, expect, test } from "bun:test"

import { createTaskLifecycle } from "./create"
import {
  cleanupProjects,
  fakeHandle,
  readEvents,
  seedRecord,
  settings,
  tempStore,
  type CallLog,
} from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

const HOST = process.pid

import { OrderRegistry } from "./__fixtures__/shutdown-order"

describe("suspendOnSessionShutdown", () => {
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
    expect(registry.get("st_000000fb")).toBeUndefined()
    expect(order.filter((step) => step === "dispose:st_000000fb")).toHaveLength(1)
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
})

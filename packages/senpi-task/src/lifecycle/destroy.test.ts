import { afterEach, describe, expect, test } from "bun:test"

import { createTaskLifecycle } from "./create"
import { ResidentTaskDisposalError } from "./destroy"
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

describe("destroyResidentTask (the single-writer destruction port)", () => {
  test("#given an in-process resident #when cancel-destroyed #then it aborts before dispose and marks disposed", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_0000000a", status: "cancelled", residency_state: "resident" })
    const registry = new FakeRegistry()
    const order: CallLog = []
    const handle = fakeHandle("st_0000000a", "in-process", order)
    registry.add(handle)
    const lifecycle = createTaskLifecycle({ store, registry, config: settings() })

    // when
    await lifecycle.destroyResidentTask("st_0000000a", "cancel")

    // then
    expect(order).toEqual(["abort:st_0000000a", "dispose:st_0000000a"])
    expect(handle.terminated()).toBe(false)
    expect(store.load("st_0000000a")?.residency_state).toBe("disposed")
    expect(registry.forgotten).toContain("st_0000000a")
    expect(readEvents(store, "st_0000000a")).toContain("destroyed")
  })

  test("#given an in-process resident whose abort rejects #when cancel-destroyed #then dispose still runs and it ends disposed", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_0000000e", status: "cancelled", residency_state: "resident" })
    const registry = new FakeRegistry()
    const order: CallLog = []
    const handle = fakeHandle("st_0000000e", "in-process", order, { abortRejects: true })
    registry.add(handle)
    const lifecycle = createTaskLifecycle({ store, registry, config: settings() })

    // when
    await lifecycle.destroyResidentTask("st_0000000e", "cancel")

    // then (abort rejection must not skip dispose or leave a resident zombie)
    expect(order).toEqual(["abort:st_0000000e", "dispose:st_0000000e"])
    expect(handle.disposed()).toBe(true)
    expect(store.load("st_0000000e")?.residency_state).toBe("disposed")
    expect(registry.forgotten).toContain("st_0000000e")
  })

  test("#given an rpc resident #when destroyed #then it terminates (TERM->KILL) then detaches, never dispose-only", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_0000000b", status: "cancelled", residency_state: "resident", execution_mode: "process" })
    const registry = new FakeRegistry()
    const order: CallLog = []
    registry.add(fakeHandle("st_0000000b", "rpc", order, { pid: 4242 }))
    const lifecycle = createTaskLifecycle({ store, registry, config: settings() })

    // when
    await lifecycle.destroyResidentTask("st_0000000b", "cancel")

    // then
    expect(order).toEqual(["terminate:st_0000000b", "dispose:st_0000000b"])
    expect(store.load("st_0000000b")?.residency_state).toBe("disposed")
  })

  test("#given dispose rejects #when destroyed #then the stale handle is still forgotten", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_0000000f", status: "cancelled", residency_state: "resident" })
    const registry = new FakeRegistry()
    registry.add(fakeHandle("st_0000000f", "in-process", [], { disposeRejects: true }))
    const lifecycle = createTaskLifecycle({ store, registry, config: settings() })

    // when
    const result = lifecycle.destroyResidentTask("st_0000000f", "cancel")

    // then
    await expect(result).rejects.toBeInstanceOf(ResidentTaskDisposalError)
    expect(registry.get("st_0000000f")).toBeUndefined()
    expect(registry.forgotten).toContain("st_0000000f")
    expect(store.load("st_0000000f")?.residency_state).toBe("disposed")
    await expect(lifecycle.destroyResidentTask("st_0000000f", "cancel")).resolves.toBeUndefined()
  })

  test("#given a terminal resident #when evicted #then residency becomes evicted and a JSONL evicted event lands", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_0000000c", status: "completed", residency_state: "resident" })
    const registry = new FakeRegistry()
    registry.add(fakeHandle("st_0000000c", "in-process", []))
    const lifecycle = createTaskLifecycle({ store, registry, config: settings() })

    // when
    await lifecycle.destroyResidentTask("st_0000000c", "evict")

    // then
    expect(store.load("st_0000000c")?.residency_state).toBe("evicted")
    expect(readEvents(store, "st_0000000c")).toContain("evicted")
  })

  test("#given no resident handle #when destroyed twice #then it is idempotent and never throws", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_0000000d", status: "cancelled", residency_state: "resident" })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings() })

    // when
    await lifecycle.destroyResidentTask("st_0000000d", "cancel")
    await lifecycle.destroyResidentTask("st_0000000d", "cancel")

    // then
    expect(store.load("st_0000000d")?.residency_state).toBe("disposed")
  })
})

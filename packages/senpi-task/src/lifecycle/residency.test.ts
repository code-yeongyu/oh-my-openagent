import { afterEach, describe, expect, test } from "bun:test"

import { AgentLimitReached } from "./errors"
import { createTaskLifecycle } from "./create"
import {
  cleanupProjects,
  fakeHandle,
  FakeRegistry,
  seedRecord,
  settings,
  tempStore,
} from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

function iso(offsetMs: number): string {
  return new Date(1_000_000 + offsetMs).toISOString()
}

describe("admitResident (residency cap + LRU eviction)", () => {
  test("#given residents below the cap #when admitting #then it is admitted with no eviction", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000001", status: "running", residency_state: "resident" })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ residency_max_children: 8 }) })

    // when
    const result = await lifecycle.admitResident("parent-1")

    // then
    expect(result.kind).toBe("admitted")
  })

  test("#given a full session with terminal residents #when admitting #then the OLDEST idle terminal is evicted", async () => {
    // given
    const store = tempStore()
    const registry = new FakeRegistry()
    const ids = ["st_000000a0", "st_000000a1"]
    ids.forEach((id, index) => {
      seedRecord(store, { task_id: id, status: "completed", residency_state: "resident", updated_at: iso(index) })
      registry.add(fakeHandle(id, "in-process", []))
    })
    const lifecycle = createTaskLifecycle({ store, registry, config: settings({ residency_max_children: 2 }) })

    // when
    const result = await lifecycle.admitResident("parent-1")

    // then
    expect(result).toEqual({ kind: "evicted", evicted_task_id: "st_000000a0" })
    expect(store.load("st_000000a0")?.residency_state).toBe("evicted")
    expect(store.load("st_000000a1")?.residency_state).toBe("resident")
  })

  test("#given the oldest terminal has a pending send #when admitting #then it is skipped and the next terminal is evicted", async () => {
    // given
    const store = tempStore()
    const registry = new FakeRegistry()
    seedRecord(store, { task_id: "st_000000b0", status: "completed", residency_state: "resident", updated_at: iso(0) })
    seedRecord(store, { task_id: "st_000000b1", status: "completed", residency_state: "resident", updated_at: iso(10) })
    registry.add(fakeHandle("st_000000b0", "in-process", []))
    registry.add(fakeHandle("st_000000b1", "in-process", []))
    registry.markPending("st_000000b0")
    const lifecycle = createTaskLifecycle({ store, registry, config: settings({ residency_max_children: 2 }) })

    // when
    const result = await lifecycle.admitResident("parent-1")

    // then
    expect(result).toEqual({ kind: "evicted", evicted_task_id: "st_000000b1" })
    expect(store.load("st_000000b0")?.residency_state).toBe("resident")
  })

  test("#given a full session with ALL residents running #when admitting #then it is rejected naming the residents, no eviction", async () => {
    // given
    const store = tempStore()
    const order: string[] = []
    const registry = new FakeRegistry()
    const ids = ["st_000000c0", "st_000000c1"]
    ids.forEach((id, index) => {
      seedRecord(store, { task_id: id, status: "running", residency_state: "resident", updated_at: iso(index) })
      registry.add(fakeHandle(id, "in-process", order))
    })
    const lifecycle = createTaskLifecycle({ store, registry, config: settings({ residency_max_children: 2 }) })

    // when
    const result = await lifecycle.admitResident("parent-1")

    // then
    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") throw new Error("expected rejection")
    expect(result.error).toBeInstanceOf(AgentLimitReached)
    expect(result.error.message).toContain("st_000000c0")
    expect(result.error.residents).toHaveLength(2)
    expect(order).toHaveLength(0)
  })

  test("#given other-session residents fill the cap #when admitting for a fresh session #then it is admitted (cap is per parent session)", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_000000d0", parent_session_id: "other", status: "running", residency_state: "resident" })
    seedRecord(store, { task_id: "st_000000d1", parent_session_id: "other", status: "running", residency_state: "resident" })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ residency_max_children: 2 }) })

    // when
    const result = await lifecycle.admitResident("parent-1")

    // then
    expect(result.kind).toBe("admitted")
  })
  test("#given lost residents pin every slot #when admitting #then the oldest lost resident is evicted (residency-leak regression)", async () => {
    // given: the leak seen live - {lost, resident} records filling the cap while real work runs
    const store = tempStore()
    seedRecord(store, { task_id: "st_000000e0", status: "lost", residency_state: "resident", updated_at: iso(0) })
    seedRecord(store, { task_id: "st_000000e1", status: "running", residency_state: "resident", updated_at: iso(10) })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ residency_max_children: 2 }) })

    // when
    const result = await lifecycle.admitResident("parent-1")

    // then
    expect(result).toEqual({ kind: "evicted", evicted_task_id: "st_000000e0" })
    expect(store.load("st_000000e0")?.residency_state).toBe("evicted")
    expect(store.load("st_000000e1")?.residency_state).toBe("resident")
  })

  test("#given a cancelled resident at the cap #when admitting #then it is evicted like any other terminal", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_000000f0", status: "cancelled", residency_state: "resident", updated_at: iso(0) })
    seedRecord(store, { task_id: "st_000000f1", status: "running", residency_state: "resident", updated_at: iso(10) })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ residency_max_children: 2 }) })

    // when
    const result = await lifecycle.admitResident("parent-1")

    // then
    expect(result).toEqual({ kind: "evicted", evicted_task_id: "st_000000f0" })
  })
})

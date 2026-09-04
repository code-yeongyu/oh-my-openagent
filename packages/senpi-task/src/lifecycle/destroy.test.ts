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

  test("#given an in-process DAG resident #when cancel-destroyed without abort #then it disposes without creating an abort promise", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000007", status: "cancelled", residency_state: "resident" })
    const registry = new FakeRegistry()
    const order: CallLog = []
    registry.add(fakeHandle("st_00000007", "in-process", order, { abortRejects: true }))
    const lifecycle = createTaskLifecycle({ store, registry, config: settings() })

    // when
    await lifecycle.destroyResidentTask("st_00000007", "cancel_without_abort")

    // then
    expect(order).toEqual(["dispose:st_00000007"])
    expect(store.load("st_00000007")?.residency_state).toBe("disposed")
    expect(registry.forgotten).toContain("st_00000007")
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

  test("#given a fallback handoff #when the old resident is torn down #then manager ownership metadata stays registered", async () => {
    // given
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_0000000f",
      status: "running",
      residency_state: "resident",
      execution_mode: "process",
    })
    const registry = new FakeRegistry()
    const order: CallLog = []
    registry.add(fakeHandle("st_0000000f", "rpc", order, { pid: 4242 }))
    const lifecycle = createTaskLifecycle({ store, registry, config: settings() })

    // when
    await lifecycle.destroyResidentTask("st_0000000f", "fallback_handoff")

    // then
    expect(order).toEqual(["terminate:st_0000000f", "dispose:st_0000000f"])
    expect(store.load("st_0000000f")?.residency_state).toBe("resident")
    expect(registry.forgotten).not.toContain("st_0000000f")
    expect(readEvents(store, "st_0000000f")).not.toContain("destroyed")
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

  test("#given a revived terminal rpc resident #when revival fails #then the destruction port tears it down and rolls it back to detached", async () => {
    const store = tempStore()
    const record = seedRecord(store, {
      task_id: "st_0000000a",
      status: "completed",
      residency_state: "resident",
      execution_mode: "process",
      host_pid: process.pid,
    })
    const preserved: typeof record = { ...record, final_response: "saved", terminal_at: "2026-09-01T00:00:00.000Z" }
    store.replace(preserved)
    const registry = new FakeRegistry()
    const order: CallLog = []
    registry.add(fakeHandle(record.task_id, "rpc", order, { pid: 4242 }))
    const lifecycle = createTaskLifecycle({ store, registry, config: settings() })

    await lifecycle.destroyResidentTask(record.task_id, "revive_failure")

    expect(order).toEqual(["terminate:st_0000000a", "dispose:st_0000000a"])
    expect(registry.forgotten).toContain(record.task_id)
    expect(store.load(record.task_id)).toMatchObject({
      status: "completed",
      residency_state: "rpc_detached",
      final_response: "saved",
      terminal_at: preserved.terminal_at,
    })
  })

  test("#given a revived terminal claim #when a foreign owner claims it during destruction #then rollback leaves the foreign claim untouched", async () => {
    const store = tempStore()
    const prior = seedRecord(store, {
      task_id: "st_0000000d",
      status: "completed",
      residency_state: "rpc_detached",
      execution_mode: "process",
      run_epoch: 0,
    })
    const revived = {
      ...prior,
      status: "running" as const,
      residency_state: "resident" as const,
      host_pid: 6000,
      notification: { ...prior.notification, run_epoch: 1 },
    }
    store.replace(revived)
    const registry = new FakeRegistry()
    registry.add({
      task_id: prior.task_id,
      kind: "rpc",
      pid: 7001,
      abort: async () => undefined,
      terminate: async () => undefined,
      dispose: async () => {
        store.replace({ ...revived, host_pid: 7000 })
      },
    })
    const lifecycle = createTaskLifecycle({ store, registry, config: settings(), hostPid: 6000 })

    await lifecycle.destroyResidentTask(prior.task_id, "revive_failure")
    const result = lifecycle.rollbackDetachedRevival(prior)

    expect(result).toBe("not_owner")
    expect(store.load(prior.task_id)).toMatchObject({
      status: "running",
      residency_state: "resident",
      host_pid: 7000,
      notification: { run_epoch: 1 },
    })
    lifecycle.dispose?.()
  })

  test("#given a revived terminal claim #when the same owner cancelled the revived epoch first #then rollback leaves the cancellation untouched", () => {
    const store = tempStore()
    const prior = seedRecord(store, {
      task_id: "st_0000000f",
      status: "completed",
      residency_state: "rpc_detached",
      execution_mode: "process",
      run_epoch: 4,
      updated_at: "2026-09-01T00:00:00.000Z",
    })
    const withTerminalFacts = { ...prior, final_response: "saved answer", terminal_at: "2026-09-01T00:00:00.000Z" }
    // The revival wrote {running, resident, epoch 5}; a user cancel then won the terminal transition
    // on that SAME epoch under the same host before rollback ran.
    store.replace({
      ...withTerminalFacts,
      status: "cancelled",
      residency_state: "resident",
      host_pid: 6000,
      error_message: "cancelled by user",
      notification: { ...prior.notification, run_epoch: 5 },
    })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings(), hostPid: 6000, now: () => Date.parse("2026-09-02T00:00:00.000Z") })

    const result = lifecycle.rollbackDetachedRevival(withTerminalFacts)
    const current = store.load(prior.task_id)

    expect(result).toBe("not_owner")
    expect(current).toMatchObject({
      status: "cancelled",
      residency_state: "resident",
      host_pid: 6000,
      error_message: "cancelled by user",
      notification: { run_epoch: 5 },
    })
  })

  test("#given a revived terminal claim #when rollback owns the new epoch #then it restores terminal facts and clears residency", () => {
    const store = tempStore()
    const prior = seedRecord(store, {
      task_id: "st_0000000e",
      status: "completed",
      residency_state: "rpc_detached",
      execution_mode: "process",
      run_epoch: 4,
      updated_at: "2026-09-01T00:00:00.000Z",
    })
    const withTerminalFacts = {
      ...prior,
      final_response: "saved answer",
      error_message: "old error",
      run_stats: { runtime_ms: 10, turns: 2, tool_calls: 1 },
      killed: false,
      terminal_at: "2026-09-01T00:00:00.000Z",
    }
    store.replace({
      ...withTerminalFacts,
      status: "running",
      residency_state: "resident",
      host_pid: 6000,
      notification: { ...prior.notification, run_epoch: 5 },
    })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings(), hostPid: 6000, now: () => Date.parse("2026-09-02T00:00:00.000Z") })

    const result = lifecycle.rollbackDetachedRevival(withTerminalFacts)
    const restored = store.load(prior.task_id)

    expect(result).toBe("rolled_back")
    expect(restored).toMatchObject({
      status: "completed",
      final_response: "saved answer",
      error_message: "old error",
      run_stats: { runtime_ms: 10, turns: 2, tool_calls: 1 },
      killed: false,
      terminal_at: "2026-09-01T00:00:00.000Z",
      residency_state: "rpc_detached",
      notification: { run_epoch: 4 },
    })
    expect(restored?.host_pid).toBeUndefined()
    lifecycle.dispose?.()
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

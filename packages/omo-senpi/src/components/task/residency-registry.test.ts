import { afterEach, describe, expect, it } from "bun:test"
import { coldReviveHarness } from "../../../../senpi-task/src/lifecycle/__fixtures__/cold-revive-harness"
import { cleanupProjects } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"

afterEach(cleanupProjects)

import type { ManagedChildHandle } from "@oh-my-opencode/senpi-task"

import { createManagerResidencyRegistry } from "./residency-registry"

type HandleCalls = {
  abort: number
  terminate: number
}

function rpcHandle(calls: HandleCalls, hasTerminatePort: boolean): ManagedChildHandle {
  const base: ManagedChildHandle = {
    task_id: "st_rpc",
    sessionId: "child-session",
    pid: 4321,
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => {
      calls.abort += 1
      return Promise.resolve()
    },
    subscribe: () => () => undefined,
    waitForOutcome: () => Promise.resolve({ status: "completed", finalResponse: "done" }),
    lastAssistantText: () => undefined,
    dispose: () => Promise.resolve(),
  }
  if (!hasTerminatePort) return base
  return {
    ...base,
    terminate: () => {
      calls.terminate += 1
      return Promise.resolve()
    },
  }
}

function registryFor(handle: ManagedChildHandle, pendingSteering: readonly unknown[] = []) {
  const manager = {
    getResidentHandle: (taskId: string) => (taskId === handle.task_id ? handle : undefined),
    residentTaskIds: () => [handle.task_id],
    forget: () => undefined,
    hasPendingSends: (taskId: string) => taskId === handle.task_id && pendingSteering.length > 0,
    get: () => undefined,
  }
  return createManagerResidencyRegistry(() => manager)
}

describe("createManagerResidencyRegistry rpc teardown bridge", () => {
  it("#given durable steering with no live handle #when the real manager registry checks #then durable pending work remains visible", async () => {
    const h = coldReviveHarness()
    const pending = [{ id: "p1", message: "PENDING", deliver_as: "steer" as const }]
    h.store.mutate(h.record.task_id, (record) => ({ ...record, pending_steering: pending }))
    try {
      expect(h.registry.get(h.record.task_id)).toBeUndefined()
      expect(h.registry.hasPendingSends(h.record.task_id)).toBe(true)
      expect(h.store.load(h.record.task_id)?.pending_steering).toEqual(pending)
    } finally { await h.dispose() }
  })

  it("#given an otherwise eligible old resident #when a durable send is pending #then teardown is blocked until the queue is resolved", async () => {
    let now = 1000
    let disposals = 0
    const h = coldReviveHarness({ now: () => now, idleTimeoutMs: 37,
      resume: async (_spec, _path, handle) => ({ ...handle, dispose: async () => { disposals += 1; await handle.dispose() } }),
    })
    const pending = [{ id: "p1", message: "PENDING", deliver_as: "steer" as const }]
    try {
      expect((await h.send()).kind).toBe("revived")
      const terminal = h.manager.waitFor(h.record.task_id, { signal: AbortSignal.timeout(5000) })
      h.fake.settle({ status: "completed", finalResponse: "DONE" })
      await terminal
      h.store.mutate(h.record.task_id, (record) => ({ ...record, pending_steering: pending }))
      now += 37
      expect(h.store.load(h.record.task_id)?.residency_state).toBe("resident")
      expect(h.registry.hasPendingSends(h.record.task_id)).toBe(true)
      expect(await h.lifecycle.reclaimIdleResidents?.()).toEqual([])
      expect(disposals).toBe(0)
      expect(h.registry.get(h.record.task_id)).toBeDefined()
      expect(h.store.load(h.record.task_id)?.pending_steering).toEqual(pending)
      h.store.mutate(h.record.task_id, (record) => ({ ...record, pending_steering: [] }))
      expect(await h.lifecycle.reclaimIdleResidents?.()).toEqual([h.record.task_id])
      expect(disposals).toBe(1)
      expect(h.store.load(h.record.task_id)?.residency_state).toBe("persisted_only")
    } finally { await h.dispose() }
  })

  it("#given a resident with a queued steering message #when pending sends are checked #then the registry reports true", () => {
    const resident = registryFor(rpcHandle({ abort: 0, terminate: 0 }, true), [{ message: "queued" }])
    expect(resident.hasPendingSends("st_rpc")).toBe(true)
  })

  it("#given an rpc resident #when lifecycle terminates it #then process termination runs without aborting the turn", async () => {
    // given
    const calls: HandleCalls = { abort: 0, terminate: 0 }
    const resident = registryFor(rpcHandle(calls, true)).get("st_rpc")
    if (resident === undefined) throw new TypeError("expected rpc resident fixture")

    // when
    await resident.terminate()

    // then
    expect(calls).toEqual({ abort: 0, terminate: 1 })
  })

  it("#given an rpc resident without a terminate port #when lifecycle terminates it #then teardown rejects instead of leaking silently", async () => {
    // given
    const calls: HandleCalls = { abort: 0, terminate: 0 }
    const resident = registryFor(rpcHandle(calls, false)).get("st_rpc")
    if (resident === undefined) throw new TypeError("expected rpc resident fixture")

    // when / then
    await expect(resident.terminate()).rejects.toThrow("rpc resident st_rpc has no terminate port")
    expect(calls).toEqual({ abort: 0, terminate: 0 })
  })
})

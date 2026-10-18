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
    kind: "rpc",
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

// A daemon-hosted child: no pid at all, and `terminate` is the handle's abort + close_session.
function hostSessionHandle(calls: HandleCalls): ManagedChildHandle {
  return {
    task_id: "st_host",
    kind: "host-session",
    sessionId: "daemon-session",
    pid: undefined,
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => {
      calls.abort += 1
      return Promise.resolve()
    },
    subscribe: () => () => undefined,
    waitForOutcome: () => Promise.resolve({ status: "completed", finalResponse: "done" }),
    lastAssistantText: () => undefined,
    terminate: () => {
      calls.terminate += 1
      return Promise.resolve()
    },
    dispose: () => Promise.resolve(),
  }
}

function registryFor(handle: ManagedChildHandle, pendingSteering: readonly unknown[] = []) {
  const manager = {
    getResidentHandle: (taskId: string) => (taskId === handle.task_id ? handle : undefined),
    residentTaskIds: () => [handle.task_id],
    forget: (_taskId: string, _options: Parameters<import("@oh-my-opencode/senpi-task").TaskManager["forget"]>[1]) => undefined,
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

  it("#given a finished resident with a durable queue #when idle reclaim runs #then it parks, frees its slot and keeps the queue", async () => {
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
      // The queue is still durable work for the next revival (#9861)...
      expect(h.registry.hasPendingSends(h.record.task_id)).toBe(true)
      // ...but it no longer pins a finished child's slot: the child parks and its handle is released.
      expect(await h.lifecycle.reclaimIdleResidents?.()).toEqual([h.record.task_id])
      expect(disposals).toBe(1)
      expect(h.registry.get(h.record.task_id)).toBeUndefined()
      expect(h.store.load(h.record.task_id)?.residency_state).toBe("persisted_only")
      expect(h.store.load(h.record.task_id)?.pending_steering).toEqual(pending)
    } finally { await h.dispose() }
  })

  it("#given a resident with a queued steering message #when pending sends are checked #then the registry reports true", () => {
    const resident = registryFor(rpcHandle({ abort: 0, terminate: 0 }, true), [{ message: "queued" }])
    expect(resident.hasPendingSends("st_rpc")).toBe(true)
    expect(resident.hasInFlightSends?.("st_rpc")).toBe(true)
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

  it("#given a daemon-hosted resident #when the registry adapts it #then its kind comes from the handle, not from the absent pid", () => {
    // given / when
    const resident = registryFor(hostSessionHandle({ abort: 0, terminate: 0 })).get("st_host")

    // then
    expect(resident?.kind).toBe("host-session")
    expect(resident?.pid).toBeUndefined()
  })

  it("#given a daemon-hosted resident #when lifecycle terminates it #then the session close reaches the handle instead of being a no-op", async () => {
    // given
    const calls: HandleCalls = { abort: 0, terminate: 0 }
    const resident = registryFor(hostSessionHandle(calls)).get("st_host")
    if (resident === undefined) throw new TypeError("expected host-session resident fixture")

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

describe("createManagerResidencyRegistry ownership (#9785)", () => {
  const manager = { forget: (_taskId: string, _options: Parameters<import("@oh-my-opencode/senpi-task").TaskManager["forget"]>[1]) => undefined, get: () => undefined, getResidentHandle: () => undefined, hasPendingSends: () => false, residentTaskIds: () => [] }

  it("#given an engine serving one session #when asked about records #then only that session's own records are owned", () => {
    // given
    let current = "session-a"
    const registry = createManagerResidencyRegistry(() => manager, () => current)

    // when / then
    expect(registry.ownsRecord?.({ parent_session_id: "session-a" })).toBe(true)
    expect(registry.ownsRecord?.({ parent_session_id: "session-b" })).toBe(false)
    current = "session-b"
    expect(registry.ownsRecord?.({ parent_session_id: "session-b" })).toBe(true)
  })

  it("#given no session accessor #when asked #then nothing is owned", () => {
    // given
    const registry = createManagerResidencyRegistry(() => manager)

    // when / then
    expect(registry.ownsRecord?.({ parent_session_id: "session-a" })).toBe(false)
  })
})

import { describe, expect, it } from "bun:test"

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

function registryFor(handle: ManagedChildHandle) {
  const manager = {
    getResidentHandle: (taskId: string) => (taskId === handle.task_id ? handle : undefined),
    residentTaskIds: () => [handle.task_id],
    forget: () => undefined,
  }
  return createManagerResidencyRegistry(() => manager)
}

describe("createManagerResidencyRegistry rpc teardown bridge", () => {
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

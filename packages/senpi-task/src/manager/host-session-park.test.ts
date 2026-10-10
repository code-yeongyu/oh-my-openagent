import { afterEach, describe, expect, test } from "bun:test"

import { hostSession, hostSessionRecordInput } from "../lifecycle/__fixtures__/host-session-fakes"
import { cleanupProjects, seedRecord, tempStore } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { RunnerError } from "../runners/in-process/runner-error"
import type { RpcRunnerSpec } from "../runners/types"
import type { SuspensionReason } from "../state"
import type { ManagedChildHandle } from "./child-handle"
import { createOutcomeTracker } from "./manager-outcome"
import { respawnManagedTask } from "./manager-respawn"

afterEach(cleanupProjects)

const SHARD = "/tmp/dh-t7/shards/p-00000000000000e1.sock"
const LEGACY = "/tmp/dh-t7/rpc.sock"

function parkingHandle(taskId: string) {
  const listeners = new Set<(event: { readonly reason: SuspensionReason }) => void>()
  const handle: ManagedChildHandle = {
    task_id: taskId,
    kind: "host-session",
    sessionId: "child",
    pid: undefined,
    onParked: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => undefined,
    waitForOutcome: () => new Promise(() => undefined),
    lastAssistantText: () => undefined,
    dispose: () => Promise.resolve(),
  }
  return { handle, listeners, park: (reason: SuspensionReason) => { for (const listener of listeners) listener({ reason }) } }
}

function trackerOver(store: ReturnType<typeof tempStore>, handle: ManagedChildHandle, forgotten: string[]) {
  return createOutcomeTracker({
    store,
    now: Date.now,
    liveHandle: (taskId) => (taskId === handle.task_id && !forgotten.includes(taskId) ? handle : undefined),
    tryLoad: (taskId) => store.load(taskId),
    runStatsSnapshot: () => undefined,
    releaseSlot: () => undefined,
    forget: (taskId) => forgotten.push(taskId),
    settleWaiters: () => undefined,
    tryRuntimeFallback: () => Promise.resolve(false),
  })
}

describe("a daemon child whose session parks parks its record", () => {
  test("#given a running child whose recorded host refused the reattach #when it parks host_incompatible #then the record is rpc_detached with that reason and the run is released", () => {
    // given
    const store = tempStore()
    const record = seedRecord(store, { ...hostSessionRecordInput("st_0e000001", hostSession("st_0e000001", { socket: SHARD })), status: "running", host_pid: 4_242 })
    const { handle, park } = parkingHandle(record.task_id)
    const forgotten: string[] = []
    trackerOver(store, handle, forgotten).trackOutcome(record.task_id, handle, record.model, record.notification.run_epoch)

    // when
    park("host_incompatible")

    // then
    const parked = store.load(record.task_id)
    expect(parked?.residency_state).toBe("rpc_detached")
    expect(parked?.suspension_reason).toBe("host_incompatible")
    expect(parked?.status).toBe("running")
    expect(parked?.host_pid).toBeUndefined()
    expect(parked?.host_session?.socket).toBe(SHARD)
    expect(forgotten).toEqual([record.task_id])
  })

  for (const cause of ["idle_evicted", "handoff_parked"] as const) {
    test(`#given a session the HOST parked as ${cause} #when the park arrives #then the record is rpc_detached with that cause, still running, and the run is released`, () => {
      // given
      const store = tempStore()
      const record = seedRecord(store, { ...hostSessionRecordInput("st_0e000002", hostSession("st_0e000002")), status: "running", host_pid: 4_242 })
      const { handle, park } = parkingHandle(record.task_id)
      const forgotten: string[] = []
      trackerOver(store, handle, forgotten).trackOutcome(record.task_id, handle, record.model, record.notification.run_epoch)

      // when
      park(cause)

      // then
      expect(store.load(record.task_id)).toMatchObject({ residency_state: "rpc_detached", suspension_reason: cause, status: "running" })
      expect(forgotten).toEqual([record.task_id])
    })
  }

  test("#given a tracked child #when the manager releases it #then a later park touches neither the record nor the manager", () => {
    // given
    const store = tempStore()
    const record = seedRecord(store, { ...hostSessionRecordInput("st_0e000004", hostSession("st_0e000004")), status: "running", host_pid: 4_242 })
    const { handle, listeners, park } = parkingHandle(record.task_id)
    const forgotten: string[] = []
    const tracker = trackerOver(store, handle, forgotten)
    tracker.trackOutcome(record.task_id, handle, record.model, record.notification.run_epoch)

    // when
    tracker.release(record.task_id)
    park("idle_evicted")

    // then
    expect(listeners.size).toBe(0)
    expect(store.load(record.task_id)?.residency_state).toBe("resident")
    expect(forgotten).toEqual([])
  })

  test("#given a child tracked twice on one handle #when it parks #then the record is parked once", () => {
    // given
    const store = tempStore()
    const record = seedRecord(store, { ...hostSessionRecordInput("st_0e000005", hostSession("st_0e000005")), status: "running", host_pid: 4_242 })
    const { handle, listeners, park } = parkingHandle(record.task_id)
    const forgotten: string[] = []
    const tracker = trackerOver(store, handle, forgotten)
    tracker.trackOutcome(record.task_id, handle, record.model, record.notification.run_epoch)
    tracker.trackOutcome(record.task_id, handle, record.model, record.notification.run_epoch)

    // when
    park("handoff_parked")

    // then
    expect(listeners.size).toBe(1)
    expect(forgotten).toEqual([record.task_id])
  })
})

describe("respawn opens a daemon child on its RECORDED socket", () => {
  function respawnWith(socket: string, failure?: RunnerError) {
    const store = tempStore()
    const record = seedRecord(store, {
      ...hostSessionRecordInput("st_0e000003", hostSession("st_0e000003", { socket })),
      spawn_spec: { cwd: "/tmp" },
      status: "running",
    })
    const specs: RpcRunnerSpec[] = []
    const result = respawnManagedTask({
      beforeLaunch: () => undefined,
      record,
      sessionPath: record.host_session?.session_path,
      stateDir: store.stateDir,
      runners: { "in-process": { start: () => Promise.reject(new Error("unused")) }, process: { start: () => Promise.reject(new Error("unused")) } },
      rpcRunner: {
        start: (spec) => {
          specs.push(spec)
          return Promise.reject(failure ?? new Error("stop after the spec is seen"))
        },
      },
    })
    return { result, specs }
  }

  test("#given a pre-migration child on the legacy socket #when it is respawned #then the runner is handed that socket", async () => {
    // given / when
    const { result, specs } = respawnWith(LEGACY)
    await result

    // then
    expect(specs.map((spec) => spec.hostSocket)).toEqual([LEGACY])
  })

  for (const reason of ["store_index_unavailable", "host_incompatible"] as const) {
    test(`#given the runner refuses with ${reason} #when respawning #then the failure is a retryable ${reason}`, async () => {
      // given
      const failure = new RunnerError({ kind: "host_unavailable", reason, message: reason })

      // when
      const { result } = respawnWith(SHARD, failure)

      // then
      expect(await result).toMatchObject({ ok: false, disposition: "retryable", code: reason })
    })
  }
})

describe("respawn hands a daemon child its remaining fallback chain (#9512)", () => {
  test("#given a recorded child with fallback models #when it is respawned #then the runner spec carries them as selectors", async () => {
    // given
    const store = tempStore()
    const record = seedRecord(store, {
      ...hostSessionRecordInput("st_0e000009", hostSession("st_0e000009", { socket: SHARD })),
      spawn_spec: { cwd: "/tmp" },
      status: "running",
      fallback_models: [
        { source: "category", provider: "openai", model_id: "gpt-5.6-sol", display: "GPT", reasoning: "high" },
        { source: "category", provider: "zai", model_id: "glm-5.3", display: "GLM" },
      ],
    })
    const specs: RpcRunnerSpec[] = []

    // when
    await respawnManagedTask({
      beforeLaunch: () => undefined,
      record,
      sessionPath: record.host_session?.session_path,
      stateDir: store.stateDir,
      runners: { "in-process": { start: () => Promise.reject(new Error("unused")) }, process: { start: () => Promise.reject(new Error("unused")) } },
      rpcRunner: {
        start: (spec) => {
          specs.push(spec)
          return Promise.reject(new Error("stop after the spec is seen"))
        },
      },
    })

    // then
    expect(specs.map((spec) => spec.fallbackModels)).toEqual([["openai/gpt-5.6-sol:high", "zai/glm-5.3"]])
  })
})

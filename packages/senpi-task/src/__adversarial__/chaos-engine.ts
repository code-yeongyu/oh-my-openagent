import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { makeHandle } from "../manager/__fixtures__/manager-fakes"
import type { FakeHandle } from "../manager/__fixtures__/manager-fakes"
import type { ManagedChildHandle, ManagedRunner, ManagedStartSpec } from "../manager"
import type { ProcessSignaller } from "../lifecycle"
import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import type { TaskRecordStore } from "../store"

export type LifecycleChaosObservations = {
  readonly actionCounts: Record<"suspend_session" | "resume_session" | "crash_mid_suspend" | "sibling_reconcile_race" | "mass_revive_at_cap", number>
  readonly liveHandleBreaches: string[]
  readonly pidBreaches: string[]
  readonly reclamationBreaches: string[]
  readonly terminalRelaunches: string[]
  readonly actionTrace: string[]
}

export class ChaosProcessTable implements ProcessSignaller {
  readonly alive = new Set<number>()
  readonly signals: string[] = []
  #nextPid = 20_000

  spawn(): number {
    const pid = this.#nextPid++
    this.alive.add(pid)
    return pid
  }
  isAlive(pid: number): boolean { return this.alive.has(pid) }
  signal(pid: number, signal: NodeJS.Signals): void {
    this.signals.push(`${signal}:${pid}`)
    this.alive.delete(pid)
  }
}

function hasSession(store: TaskRecordStore, taskId: string): boolean {
  const directory = join(store.stateDir, "children", taskId, "sessions")
  return existsSync(directory) && readdirSync(directory).some((entry) => entry.endsWith(".jsonl"))
}

function observeLaunch(
  engineId: string,
  taskId: string,
  store: TaskRecordStore,
  processes: ChaosProcessTable,
  observations: LifecycleChaosObservations,
): void {
  const record = store.load(taskId)
  if (record !== null && (record.status === "completed" || record.status === "error" || record.status === "interrupted") && !hasSession(store, taskId)) {
    observations.terminalRelaunches.push(`${engineId}:${taskId}`)
  }
  if (record?.pid !== undefined && processes.isAlive(record.pid)) {
    observations.pidBreaches.push(`replacement for ${taskId} spawned before retained pid ${record.pid} was terminated`)
  }
}

export class ChaosRunner implements ManagedRunner {
  readonly handles = new Map<string, FakeHandle>()
  readonly allHandles: FakeHandle[] = []
  readonly startedTaskIds: string[] = []
  readonly resumedTaskIds: string[] = []
  readonly #engineId: string
  readonly #mode: "in-process" | "process"
  readonly #store: TaskRecordStore
  readonly #processes: ChaosProcessTable
  readonly #observations: LifecycleChaosObservations

  constructor(input: {
    engineId: string
    mode: "in-process" | "process"
    store: TaskRecordStore
    processes: ChaosProcessTable
    observations: LifecycleChaosObservations
  }) {
    this.#engineId = input.engineId
    this.#mode = input.mode
    this.#store = input.store
    this.#processes = input.processes
    this.#observations = input.observations
  }

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    this.startedTaskIds.push(spec.taskId)
    return Promise.resolve(this.#launch(spec.taskId))
  }

  resume(spec: ManagedStartSpec, _sessionPath: string): Promise<ManagedChildHandle> {
    this.resumedTaskIds.push(spec.taskId)
    return Promise.resolve(this.#launch(spec.taskId))
  }

  #launch(taskId: string): ManagedChildHandle {
    observeLaunch(this.#engineId, taskId, this.#store, this.#processes, this.#observations)
    const pid = this.#mode === "process" ? this.#processes.spawn() : undefined
    const fake = makeHandle(taskId, pid)
    let disposed = false
    const handle: ManagedChildHandle = {
      ...fake.handle,
      ...(pid === undefined ? {} : { pid }),
      terminate: async () => { if (pid !== undefined) this.#processes.signal(pid, "SIGTERM") },
      dispose: async () => {
        if (disposed) return
        disposed = true
        if (pid !== undefined) this.#processes.alive.delete(pid)
      },
    }
    const tracked: FakeHandle = { ...fake, handle }
    this.handles.set(taskId, tracked)
    this.allHandles.push(tracked)
    return handle
  }
}

export class ChaosRpcRespawnRunner {
  readonly #store: TaskRecordStore
  readonly #processes: ChaosProcessTable
  readonly #observations: LifecycleChaosObservations

  constructor(store: TaskRecordStore, processes: ChaosProcessTable, observations: LifecycleChaosObservations) {
    this.#store = store
    this.#processes = processes
    this.#observations = observations
  }

  start(spec: RpcRunnerSpec): RpcChildHandle {
    observeLaunch("rpc-respawn", spec.task_id, this.#store, this.#processes, this.#observations)
    const pid = this.#processes.spawn()
    return {
      task_id: spec.task_id,
      sessionId: `rpc-${spec.task_id}`,
      pid,
      steer: async () => {},
      followUp: async () => {},
      abort: async () => {},
      subscribe: () => () => {},
      waitForIdle: async () => {},
      lastAssistantText: () => "rpc resumed",
      dispose: async () => { this.#processes.alive.delete(pid) },
      switchSession: async () => ({ cancelled: false }),
      terminate: async () => { this.#processes.signal(pid, "SIGTERM") },
      exitOutcome: () => undefined,
      waitForExit: async () => ({ kind: "clean", facts: { pid, code: 0, signal: null, stderrTail: "" } }),
      lastSeen: () => undefined,
    }
  }
}

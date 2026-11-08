import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import { log } from "@oh-my-opencode/utils"

import {
  prepareIsolation,
  settleIsolation,
  type IsolationHandle,
  type IsolationOwner,
  type IsolationPreparation,
  type IsolationRuntime,
  type WorktreeBaseline,
} from "../isolation"
import type { TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import type { ManagedChildHandle } from "./child-handle"
import type { ManagerStartSpec } from "./types"

export type IsolationWiringPorts = {
  readonly runtime: IsolationRuntime | undefined
  readonly store: TaskRecordStore
  readonly cwd: string
  readonly hostPid: number
  readonly config: OmoTaskSettings
}

export type IsolationWiring = {
  isolates(spec: ManagerStartSpec): boolean
  prepare(spec: ManagerStartSpec, taskId: string): Promise<IsolationPreparation>
  bind(taskId: string, handle: IsolationHandle, baseline: WorktreeBaseline): void
  discard(taskId: string): Promise<void>
  /** Stamp the child's own identity onto the clone so a sweep can tell a live child from a dead host. */
  stamp(taskId: string, handle: ManagedChildHandle): Promise<void>
  settle(taskId: string, merge: boolean): Promise<void>
}

type Binding = { readonly handle: IsolationHandle; readonly baseline: WorktreeBaseline }

export function createIsolationWiring(ports: IsolationWiringPorts): IsolationWiring {
  const bindings = new Map<string, Binding>()

  const childOwner = (handle: ManagedChildHandle): IsolationOwner["child"] => {
    const hostSession = handle.hostSession
    if (hostSession !== undefined) {
      return { kind: "host-session", socket: hostSession.socket, session_path: hostSession.sessionPath }
    }
    return handle.pid === undefined ? undefined : { kind: "process", pid: handle.pid }
  }

  return {
    isolates: (spec) => spec.isolated ?? ports.config.isolation.enabled,

    async prepare(spec, taskId) {
      if (ports.runtime === undefined) return { ok: false, reason: "no isolation runtime is wired into this session" }
      return prepareIsolation({
        runtime: ports.runtime,
        cwd: ports.cwd,
        taskId,
        stateDir: ports.store.stateDir,
        backend: ports.config.isolation.backend,
        mode: spec.merge ?? ports.config.isolation.merge,
        apply: spec.apply ?? ports.config.isolation.apply,
        hostPid: ports.hostPid,
      })
    },

    bind(taskId, handle, baseline) {
      bindings.set(taskId, { handle, baseline })
    },

    async discard(taskId) {
      const binding = bindings.get(taskId)
      bindings.delete(taskId)
      if (binding === undefined || ports.runtime === undefined) return
      await ports.runtime.cleanup(binding.handle).catch((error: unknown) => {
        log("senpi-task isolation cleanup failed", { taskId, error: String(error) })
      })
    },

    async stamp(taskId, handle) {
      const binding = bindings.get(taskId)
      const child = childOwner(handle)
      if (binding === undefined || ports.runtime === undefined || child === undefined) return
      await ports.runtime
        .writeOwner(binding.handle.baseDir, taskId, { host: { pid: ports.hostPid }, child })
        .catch((error: unknown) => log("senpi-task isolation owner stamp failed", { taskId, error: String(error) }))
    },

    async settle(taskId, merge) {
      const runtime = ports.runtime
      if (runtime === undefined) return
      const record: TaskRecord | null = ports.store.load(taskId)
      const isolation = record?.isolation
      if (record === null || isolation === undefined || isolation.merge_result !== undefined) return
      const binding = bindings.get(taskId)
      bindings.delete(taskId)
      const merge_result = await settleIsolation({
        runtime,
        stateDir: ports.store.stateDir,
        taskId,
        isolation,
        merge,
        ...(merge ? {} : { reason: "child did not complete" }),
        ...(binding === undefined ? {} : { baseline: binding.baseline, handle: binding.handle }),
      })
      ports.store.mutate(taskId, (fresh) =>
        fresh.isolation === undefined ? fresh : { ...fresh, isolation: { ...fresh.isolation, merge_result } })
    },
  }
}

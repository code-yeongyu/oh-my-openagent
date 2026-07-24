import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"

import { isProcessPid } from "../state/pid"
import type { TaskRecordStore } from "../store"
import { injectedLifecycleReattachPorts } from "./port"
import type { LifecycleDeps, LifecycleReattachPorts, ProcessSignaller, ResidencyRegistry } from "./port"

export type LifecycleContext = {
  readonly store: TaskRecordStore
  readonly registry: ResidencyRegistry
  readonly config: OmoTaskSettings
  readonly now: () => number
  readonly signaller: ProcessSignaller
  readonly hostPid: number
  readonly reattachPorts: LifecycleReattachPorts | undefined
}

export const defaultSignaller: ProcessSignaller = {
  isAlive(pid) {
    if (!isProcessPid(pid)) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return "code" in error && error.code === "EPERM"
    }
  },
}

export function resolveContext(deps: LifecycleDeps): LifecycleContext {
  return {
    store: deps.store,
    registry: deps.registry,
    config: deps.config,
    now: deps.now ?? Date.now,
    signaller: deps.signaller ?? defaultSignaller,
    hostPid: deps.hostPid ?? process.pid,
    reattachPorts: injectedLifecycleReattachPorts(deps),
  }
}

export function nowIso(context: LifecycleContext): string {
  return new Date(context.now()).toISOString()
}

export const TERMINAL_STATUSES = new Set(["completed", "error", "cancelled", "interrupted", "lost"])

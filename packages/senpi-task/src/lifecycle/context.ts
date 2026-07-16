import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import { log } from "@oh-my-opencode/utils"

import type { TaskRecordStore } from "../store"
import { injectedLifecycleReattachPorts } from "./port"
import type { LifecycleDeps, LifecycleReattachPorts, ProcessSignaller, ResidencyRegistry } from "./port"

const DEFAULT_ORPHAN_KILL_DELAY_MS = 5_000

export type LifecycleContext = {
  readonly store: TaskRecordStore
  readonly registry: ResidencyRegistry
  readonly config: OmoTaskSettings
  readonly now: () => number
  readonly signaller: ProcessSignaller
  readonly orphanKillDelayMs: number
  readonly reattachPorts: LifecycleReattachPorts | undefined
}

// The sole default OS-process signaller: process.kill lives here (audited-in via src/lifecycle) so
// no other module needs to reach for it. Signal 0 probes existence; EPERM means the pid exists but
// belongs to another user, which still counts as alive.
export const defaultSignaller: ProcessSignaller = {
  isAlive(pid) {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM"
    }
  },
  signal(pid, signal) {
    try {
      process.kill(pid, signal)
    } catch (error) {
      log("senpi-task orphan signal skipped", { pid, signal, error: String(error) })
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
    orphanKillDelayMs: deps.orphanKillDelayMs ?? DEFAULT_ORPHAN_KILL_DELAY_MS,
    reattachPorts: injectedLifecycleReattachPorts(deps),
  }
}

export function nowIso(context: LifecycleContext): string {
  return new Date(context.now()).toISOString()
}

export const TERMINAL_STATUSES = new Set(["completed", "error", "cancelled", "interrupted", "lost"])

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

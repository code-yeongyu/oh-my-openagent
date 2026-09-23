import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import type { IsolationRuntime, OwnerProbe } from "../isolation"
import { log } from "@oh-my-opencode/utils"

import type { KernelToolBindingRegistry } from "../kernel-tools/bindings"
import type { TaskRecordStore } from "../store"
import {
  DEFAULT_HOST_SESSION_RETRY_POLICY,
  type HostSessionCloser,
  type HostSessionProbe,
  type HostSessionRetryPolicy,
} from "./host-session"
import { defaultHostSessionCloser, defaultHostSessionProbe } from "./host-session-default"
import { injectedLifecycleReattachPorts } from "./port"
import type { IdleReclaimerScheduler, LifecycleDeps, LifecycleReattachPorts, ProcessSignaller, ResidencyRegistry } from "./port"
import type { BatchAdmissionOptions } from "./residency"

import { defaultIdleReclaimerScheduler } from "./idle-reclaimer-scheduler"
export { createIdleReclaimerScheduler, defaultIdleReclaimerScheduler } from "./idle-reclaimer-scheduler"

const DEFAULT_ORPHAN_KILL_DELAY_MS = 5_000

export type LifecycleContext = {
  readonly revivePolicy?: LifecycleDeps["revivePolicy"]
  readonly store: TaskRecordStore
  readonly registry: ResidencyRegistry
  readonly config: OmoTaskSettings
  readonly now: () => number
  readonly signaller: ProcessSignaller
  readonly orphanKillDelayMs: number
  readonly hostPid: number
  readonly dequeuePending: (taskId: string) => void
  readonly reattachPorts: LifecycleReattachPorts | undefined
  readonly reconcileAdmission: BatchAdmissionOptions
  readonly idleReclaimerScheduler: IdleReclaimerScheduler
  // Runtime-only parent kernel-tool map (item 6). Deliberate destruction and record expunge release
  // a child's binding here; idle parking deliberately does NOT.
  readonly kernelToolBindings: KernelToolBindingRegistry | undefined
  // Liveness of daemon-hosted children: ONE probeHost + ONE list_sessions per pass, matched by
  // session path. `hostSessionClose` is the ONLY way a session this process does not hold is ended.
  readonly hostSessionProbe: HostSessionProbe
  readonly hostSessionClose: HostSessionCloser | undefined
  readonly hostRetry: HostSessionRetryPolicy
  readonly isolation: IsolationRuntime | undefined
  readonly isolationProbe: OwnerProbe | undefined
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
    revivePolicy: deps.revivePolicy,
    registry: deps.registry,
    config: deps.config,
    now: deps.now ?? Date.now,
    signaller: deps.signaller ?? defaultSignaller,
    orphanKillDelayMs: deps.orphanKillDelayMs ?? DEFAULT_ORPHAN_KILL_DELAY_MS,
    hostPid: deps.hostPid ?? process.pid,
    dequeuePending: deps.dequeuePending ?? (() => {}),
    reattachPorts: injectedLifecycleReattachPorts(deps),
    reconcileAdmission: deps.reconcileAdmission ?? {},
    idleReclaimerScheduler: deps.idleReclaimerScheduler ?? defaultIdleReclaimerScheduler,
    kernelToolBindings: deps.kernelToolBindings,
    hostSessionProbe: deps.hostSessionProbe ?? defaultHostSessionProbe(),
    hostSessionClose: deps.hostSessionClose ?? defaultHostSessionCloser,
    hostRetry: deps.hostRetry ?? DEFAULT_HOST_SESSION_RETRY_POLICY,
    isolation: deps.isolation,
    isolationProbe: deps.isolationProbe,
  }
}

export function nowIso(context: LifecycleContext): string {
  return new Date(context.now()).toISOString()
}

export const TERMINAL_STATUSES = new Set(["completed", "error", "cancelled", "interrupted", "lost"])

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

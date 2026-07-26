import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"

import type { ManagedChildHandle } from "../manager/child-handle"
import type { TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"

// Why a task is being torn down. Cancel (todo 10), LRU eviction, TTL cleanup, session shutdown, and
// session_start reconciliation ALL route their destruction through the single-writer port.
export type DestroyCause = "cancel" | "evict" | "ttl" | "shutdown" | "reconcile_lost"

// The teardown surface the destruction port operates against. In production this wraps a live
// ManagedChildHandle (in-process) or an rpc child handle (rpc); tests inject fakes. ONLY lifecycle
// code ever calls abort/dispose/terminate on it - that is the single-writer rule.
export type ResidentHandle = {
  readonly task_id: string
  readonly kind: "in-process" | "rpc"
  readonly pid: number | undefined
  // Interrupt an in-flight turn. Safe to call on an already-idle child.
  abort(): Promise<void>
  // In-process: tear down the child session. Rpc: detach the protocol client + heartbeat.
  dispose(): Promise<void>
  // Rpc only: SIGTERM then SIGKILL escalation. In-process: no-op (no OS process to signal).
  terminate(): Promise<void>
}

// The live view of which handles are resident in THIS process, plus pending-mail state. Records
// persist residency across restarts; the registry only knows handles this process owns.
export type ResidencyRegistry = {
  get(taskId: string): ResidentHandle | undefined
  entries(): readonly ResidentHandle[]
  forget(taskId: string): void
  // A terminal resident with a queued send must NOT be evicted (codex is_unloadable parity).
  hasPendingSends(taskId: string): boolean
}

// Injectable OS-process signalling so unit tests never spawn real children. Defaults use
// process.kill (the sole audited process.kill site lives in src/lifecycle).
export type ProcessSignaller = {
  isAlive(pid: number): boolean
  signal(pid: number, signal: "SIGTERM" | "SIGKILL"): void
}

export type RespawnResult =
  | { readonly ok: true; readonly handle: ManagedChildHandle }
  | { readonly ok: false; readonly reason: string }

export type ReattachResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: "already_attached" | "failed"; readonly reason: string }

export type RespawnPort = (record: TaskRecord, resumeSessionPath: string) => Promise<RespawnResult>
export type ReattachPort = (record: TaskRecord, handle: ManagedChildHandle) => Promise<ReattachResult>

export type LifecycleReattachPorts = {
  readonly respawn: RespawnPort
  readonly reattach: ReattachPort
}

const registeredReattachPorts = new WeakMap<TaskRecordStore, LifecycleReattachPorts>()

export function registerLifecycleReattachPorts(
  store: TaskRecordStore,
  ports: LifecycleReattachPorts,
): void {
  registeredReattachPorts.set(store, ports)
}

export function getLifecycleReattachPorts(store: TaskRecordStore): LifecycleReattachPorts | undefined {
  return registeredReattachPorts.get(store)
}

export type LifecycleDeps = {
  readonly store: TaskRecordStore
  readonly registry: ResidencyRegistry
  readonly config: OmoTaskSettings
  readonly now?: () => number
  readonly signaller?: ProcessSignaller
  readonly respawn?: RespawnPort
  readonly reattach?: ReattachPort
  // Delay before escalating an orphan SIGTERM to SIGKILL during reconciliation. Defaults to 5s.
  readonly orphanKillDelayMs?: number
  // Pid of THIS host process. Defaults to process.pid; injectable so reconciliation tests can
  // simulate cross-process ownership deterministically.
  readonly hostPid?: number
}

export function injectedLifecycleReattachPorts(deps: LifecycleDeps): LifecycleReattachPorts | undefined {
  if (deps.respawn === undefined || deps.reattach === undefined) return undefined
  return { respawn: deps.respawn, reattach: deps.reattach }
}

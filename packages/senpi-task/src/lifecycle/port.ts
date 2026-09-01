import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"

import type { ManagedChildHandle } from "../manager/child-handle"
import type { TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import type { BatchAdmissionOptions } from "./residency"

// Why a task is being torn down. Cancel (todo 10), LRU eviction, TTL cleanup, and session_start
// reconciliation ALL route their destruction through the single-writer port. Session shutdown is
// NOT here: it suspends revivable children (shutdown.ts) and only routes deliberately-stopped
// children through the port, under the "cancel" deliberate-stop family.
export type DestroyCause =
  | "cancel"
  | "cancel_without_abort"
  | "evict"
  | "ttl"
  | "reconcile_lost"
  | "fallback_handoff"

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
  // Synchronous per-task arbitration held across async teardown. Eviction and sends are mutually
  // exclusive; callers that lose the race must not touch the child handle.
  tryClaimEviction?(taskId: string): boolean
  releaseEviction?(taskId: string): void
  isEvicting?(taskId: string): boolean
  tryBeginSend?(taskId: string): boolean
  endSend?(taskId: string): void
}

// Injectable OS-process signalling so unit tests never spawn real children. Defaults use
// process.kill (the sole audited process.kill site lives in src/lifecycle).
export type ProcessSignaller = {
  isAlive(pid: number): boolean
  signal(pid: number, signal: "SIGTERM" | "SIGKILL"): void
}

export type RespawnFailureCode =
  | "model_unavailable"
  | "tools_unavailable"
  | "spawn_spec_unavailable"
  | "session_unavailable"
  | "team_inactive"
  | "respawn_failed"

export type RespawnResult =
  | { readonly ok: true; readonly handle: ManagedChildHandle }
  | {
      readonly ok: false
      readonly disposition: "retryable" | "unrecoverable"
      readonly code: RespawnFailureCode
      readonly reason: string
    }

export type ReattachResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: "already_attached" | "failed"; readonly reason: string }

export type CapacityReservation =
  | { readonly ok: false }
  | { readonly ok: true; release(): void }

export type RespawnPort = (record: TaskRecord, resumeSessionPath?: string) => Promise<RespawnResult>
export type ReattachPort = (record: TaskRecord, handle: ManagedChildHandle) => Promise<ReattachResult>
export type ReserveReattachPort = (record: TaskRecord) => CapacityReservation

export type LifecycleReattachPorts = {
  readonly reserve: ReserveReattachPort
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

export type IdleReclaimerTimer = {
  unref?(): void
}

export type IdleReclaimerScheduler = {
  setInterval(callback: () => void, delayMs: number): IdleReclaimerTimer
  clearInterval(timer: IdleReclaimerTimer): void
}

export type LifecycleDeps = {
  readonly store: TaskRecordStore
  readonly registry: ResidencyRegistry
  readonly config: OmoTaskSettings
  readonly now?: () => number
  readonly signaller?: ProcessSignaller
  readonly reserveReattach?: ReserveReattachPort
  readonly respawn?: RespawnPort
  readonly reattach?: ReattachPort
  // Delay before escalating an orphan SIGTERM to SIGKILL during reconciliation. Defaults to 5s.
  readonly orphanKillDelayMs?: number
  // Pid of THIS host process. Defaults to process.pid; injectable so reconciliation tests can
  // simulate cross-process ownership deterministically.
  readonly hostPid?: number
  // Remove a queued (never-launched) child from the concurrency queue when session shutdown
  // suspends it. Defaults to a no-op; the manager wires its real dequeue through here.
  readonly dequeuePending?: (taskId: string) => void
  // Test seam for bounded admission-lease timing and deterministic contention.
  readonly reconcileAdmission?: BatchAdmissionOptions
  // Injectable timer seam keeps lifecycle tests deterministic and prevents test-created timers.
  readonly idleReclaimerScheduler?: IdleReclaimerScheduler
}

export function injectedLifecycleReattachPorts(deps: LifecycleDeps): LifecycleReattachPorts | undefined {
  if (deps.respawn === undefined || deps.reattach === undefined) return undefined
  return {
    reserve: deps.reserveReattach ?? (() => ({ ok: true, release: () => undefined })),
    respawn: deps.respawn,
    reattach: deps.reattach,
  }
}

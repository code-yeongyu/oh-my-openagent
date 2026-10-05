import type { ManagedChildHandle } from "../manager/child-handle"
import type { ColdRevivalFailureCode, DetachedRevivalResult, DetachedRevivalRollbackResult } from "../lifecycle/port"
import type { HostSessionIdentity, TaskRecord, TaskRunStats, TaskStatus } from "../state"
import type { TaskRecordStore } from "../store"

// `reconcile_lost`: a child whose handle cleanup rejected is recorded on its terminal record and ended
// through the lifecycle's orphan path (pid signal or daemon session close).
export type DestructionCause = "cancel" | "cancel_without_abort" | "fallback_handoff" | "revive_failure" | "reconcile_lost"

// Structural port implemented by lifecycle (todo 12). Steering delegates ALL child destruction here
// and NEVER calls dispose()/terminate()/SIGTERM itself (the dispose single-writer rule). Idempotent.
export type DestructionPort = {
  destroyResidentTask(taskId: string, cause: DestructionCause): Promise<void>
}

// The seam steering consumes from the manager. The manager owns concurrency + live handles + the
// record store; steering reads through this port so it never forks that state.
export type ReviveReservation =
  | { readonly ok: false }
  | { readonly ok: true; commit(): void; release(): void }

export type SteeringPort = {
  readonly store: TaskRecordStore
  tryBeginSend?(taskId: string): boolean
  endSend?(taskId: string): void
  isEvicting?(taskId: string): boolean
  liveHandle(taskId: string): ManagedChildHandle | undefined
  dequeuePending(taskId: string): boolean
  reserveForRevive(taskId: string): ReviveReservation
  reserveForDetachedRevive?(record: TaskRecord): ReviveReservation
  reviveDetached?(taskId: string, reservation?: ReviveReservation): Promise<DetachedRevivalResult>
  // Whether the daemon hosting a parked child still answers. Absent when this process has no
  // daemon view at all, which reads as "unreachable" - the conservative answer.
  isDaemonReachable?(hostSession: HostSessionIdentity): boolean
  rollbackDetachedRevival?(prior: TaskRecord): DetachedRevivalRollbackResult
  readonly destruction: DestructionPort
  // Snapshot of the manager-owned run-stats accumulator for a live task, attached to the cancel
  // transition steering performs (the manager's later outcome transition is late-transition
  // ignored by terminal idempotence, so this is the only chance cancel has).
  runStatsSnapshot(taskId: string): TaskRunStats | undefined
  // A cancel that must wait for the child's lost connection: until `stopSettled`, only the cancel ends
  // that run, so no failure the stop itself causes is written over it.
  stopRequested?(taskId: string): void
  stopSettled?(taskId: string): void
  // A reopened child handed back parked runs nowhere: no epoch of it keeps a lane slot.
  releaseTaskLeases?(taskId: string): void
  now(): number
}

export type SendDelivery = "steer" | "followUp"

export type SendInput = {
  readonly idOrName: string
  readonly message: string
  readonly deliverAs?: SendDelivery
  readonly callerSessionId?: string
  readonly allScope?: boolean
  // Deliver only to the run a handle minted at this epoch names (fenceRun): any other run answers
  // `stale` and nothing is delivered. task_send never sets it.
  readonly expectedRunEpoch?: number
}

// The SEND DEFAULT is "followUp": codex's followup_task routes a send to a running child as a
// follow-up prompt, not an interrupting steer. "steer" is opt-in for polite mid-turn injection.
export const DEFAULT_SEND_DELIVERY: SendDelivery = "followUp"

export type SendOutcome =
  | { readonly kind: ColdRevivalFailureCode; readonly task_id: string; readonly reason: string }
  | { readonly kind: "steered"; readonly task_id: string; readonly status: TaskStatus; readonly delivered: SendDelivery }
  | { readonly kind: "revived"; readonly task_id: string; readonly run_epoch: number }
  | {
      readonly kind: "delivery_uncertain"
      readonly task_id: string
      readonly run_epoch: number
      readonly reason: string
      readonly suggestion: string
    }
  | { readonly kind: "capacity_deferred"; readonly task_id: string; readonly reason: string }
  | { readonly kind: "queued"; readonly task_id: string; readonly queue_position: number }
  | { readonly kind: "not_continuable"; readonly task_id: string; readonly reason: string; readonly suggestion: string }
  /** The caller named an earlier run (`expectedRunEpoch`) and the task has moved on; nothing was delivered. */
  | { readonly kind: "stale"; readonly task_id: string; readonly run_epoch: number; readonly reason: string }
  // One-shot agents (see agents/interaction-policy.ts) refuse task_send in EVERY state; message is
  // the registry's sendDenialReminder, surfaced to the caller verbatim.
  | { readonly kind: "one_shot_agent"; readonly task_id: string; readonly agent: string; readonly message: string }
  | { readonly kind: "scope_denied"; readonly task_id: string; readonly owning_session_id: string; readonly reason: string }
  | { readonly kind: "not_found"; readonly reason: string; readonly suggestion: string }

export type InterruptOutcome =
  | { readonly kind: "interrupted"; readonly task_id: string; readonly previous_status: TaskStatus }
  | { readonly kind: "noop"; readonly task_id: string; readonly status: TaskStatus; readonly reason: string }
  | { readonly kind: "not_found"; readonly reason: string }

export type CancelOptions = {
  readonly abort?: "request" | "skip"
  // Cancel only the run a handle minted at this epoch names: any other run answers `stale` and
  // nothing is cancelled. task_cancel never sets it.
  readonly expectedRunEpoch?: number
}

export type CancelOutcome =
  | { readonly kind: "cancelled"; readonly task_id: string; readonly previous_status: TaskStatus }
  // The child is unreachable right now: the cancel runs on its host before anything else once it is
  // reachable (or the child ends when its connection does not come back), and only then is it cancelled.
  | { readonly kind: "cancel_pending"; readonly task_id: string; readonly previous_status: TaskStatus; readonly reason: string }
  | { readonly kind: "noop"; readonly task_id: string; readonly status: TaskStatus; readonly reason: string }
  /** The caller named an earlier run (`expectedRunEpoch`) and the task has moved on; nothing was cancelled. */
  | { readonly kind: "stale"; readonly task_id: string; readonly status: TaskStatus; readonly run_epoch: number; readonly reason: string }
  | { readonly kind: "not_found"; readonly reason: string }

export type SteeringEngine = {
  hasPendingSends(taskId: string): boolean
  // Internal manager grant consumption; ordinary task_send callers never supply a reservation.
  sendToTask(input: SendInput, reservation?: ReviveReservation): Promise<SendOutcome>
  interruptTask(idOrName: string): Promise<InterruptOutcome>
  cancelTask(idOrName: string, reason?: string, options?: CancelOptions): Promise<CancelOutcome>
  // Called by the manager right after a queued child launches: drains ordered pending messages.
  notifyStarted(taskId: string): Promise<void>
  // Called by the manager when a task is forgotten (destroyed/evicted/failed to launch) so buffered
  // messages for a child that will never start are not retained for the session.
  dropPending(taskId: string): void
}

export type { TaskRecord }

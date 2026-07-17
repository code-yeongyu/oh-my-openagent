import type { ManagedChildHandle } from "../manager/child-handle"
import type { TaskRecord, TaskStatus } from "../state"
import type { TaskRecordStore } from "../store"

export type DestructionCause = "cancel"

// Structural port implemented by lifecycle (todo 12). Steering delegates ALL child destruction here
// and NEVER calls dispose()/terminate()/SIGTERM itself (the dispose single-writer rule). Idempotent.
export type DestructionPort = {
  destroyResidentTask(taskId: string, cause: DestructionCause): Promise<void>
}

// The seam steering consumes from the manager. The manager owns concurrency + live handles + the
// record store; steering reads through this port so it never forks that state.
export type SteeringPort = {
  readonly store: TaskRecordStore
  liveHandle(taskId: string): ManagedChildHandle | undefined
  dequeuePending(taskId: string): boolean
  // Re-account a revived (now-running) child: re-acquire its concurrency slot and re-arm outcome
  // tracking under the NEW run_epoch so the later release is not swallowed by the release guard.
  reacquireForRevive(taskId: string): void
  readonly destruction: DestructionPort
  now(): number
}

export type SendDelivery = "steer" | "followUp"

export type SendInput = {
  readonly idOrName: string
  readonly message: string
  readonly deliverAs?: SendDelivery
  readonly callerSessionId?: string
  readonly allScope?: boolean
}

// The SEND DEFAULT is "followUp": codex's followup_task routes a send to a running child as a
// follow-up prompt, not an interrupting steer. "steer" is opt-in for polite mid-turn injection.
export const DEFAULT_SEND_DELIVERY: SendDelivery = "followUp"

export type SendOutcome =
  | { readonly kind: "steered"; readonly task_id: string; readonly status: TaskStatus; readonly delivered: SendDelivery }
  | { readonly kind: "revived"; readonly task_id: string; readonly run_epoch: number }
  | { readonly kind: "queued"; readonly task_id: string; readonly queue_position: number }
  | { readonly kind: "not_continuable"; readonly task_id: string; readonly reason: string; readonly suggestion: string }
  | { readonly kind: "scope_denied"; readonly task_id: string; readonly owning_session_id: string; readonly reason: string }
  | { readonly kind: "not_found"; readonly reason: string; readonly suggestion: string }

export type InterruptOutcome =
  | { readonly kind: "interrupted"; readonly task_id: string; readonly previous_status: TaskStatus }
  | { readonly kind: "noop"; readonly task_id: string; readonly status: TaskStatus; readonly reason: string }
  | { readonly kind: "not_found"; readonly reason: string }

export type CancelOutcome =
  | { readonly kind: "cancelled"; readonly task_id: string; readonly previous_status: TaskStatus }
  | { readonly kind: "noop"; readonly task_id: string; readonly status: TaskStatus; readonly reason: string }
  | { readonly kind: "not_found"; readonly reason: string }

export type SteeringEngine = {
  sendToTask(input: SendInput): Promise<SendOutcome>
  interruptTask(idOrName: string): Promise<InterruptOutcome>
  cancelTask(idOrName: string, reason?: string): Promise<CancelOutcome>
  // Called by the manager right after a queued child launches: drains ordered pending messages.
  notifyStarted(taskId: string): Promise<void>
  // Called by the manager when a task is forgotten (destroyed/evicted/failed to launch) so buffered
  // messages for a child that will never start are not retained for the session.
  dropPending(taskId: string): void
}

export type { TaskRecord }

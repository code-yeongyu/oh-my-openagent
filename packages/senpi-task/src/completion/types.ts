import type { ResolvedModelRecord, TaskRecord, TaskRunStats, TaskStatus } from "../state"
import type { ListTaskRecordsResult, PersistedTaskEvent } from "../store"

export type TransitionReason = "compacting" | "session_switching" | "session_shutdown"

// The live parent-session state the completion push routes against (Metis #3 five-state machine).
export type ParentState =
  | { readonly kind: "idle" }
  | { readonly kind: "streaming" }
  | { readonly kind: "compacting" }
  | { readonly kind: "session_switching" }
  | { readonly kind: "session_shutdown" }

export type RoutingDecision =
  | { readonly kind: "wake" }
  | { readonly kind: "deliver_streaming" }
  | { readonly kind: "buffer"; readonly reason: TransitionReason }

export type CompletionDetails = {
  readonly task_id: string
  readonly name: string
  readonly status: TaskStatus
  readonly category?: string
  readonly agent_type?: string
  readonly model: string
  readonly requested_model?: ResolvedModelRecord
  readonly fallback_models?: readonly ResolvedModelRecord[]
  readonly resolved_model?: ResolvedModelRecord
  readonly duration_ms: number
  readonly tokens?: number
  readonly run_stats?: TaskRunStats
  readonly final_response: string
  readonly final_response_file?: string
  readonly continuation_hint: string
  // Present only when the completed task was a DAG node child, so the parent can address the exact
  // node it must re-verify or correct.
  readonly dag?: {
    readonly run_id: string
    readonly node_id: string
  }
}

// Structurally compatible with senpi sendMessage(Pick<CustomMessage,"customType"|"content"|"display"|
// "details">, {triggerTurn, deliverAs}). One message carries one or many completions (batching).
// Delivery is UNCONDITIONAL STEER: every delivered notification triggers a turn and steers into the
// running turn at the next tool-call boundary; the adapter batches all ready messages into ONE steer.
export type ParentNotifierMessage = {
  readonly customType: "senpi-task.completion"
  readonly content: string
  readonly display: boolean
  readonly details: readonly CompletionDetails[]
  readonly triggerTurn?: boolean
}

// SYNCHRONOUS enqueue seam. senpi pi.sendMessage returns void and swallows async delivery errors, so
// the only observable failure is a synchronous throw from enqueue. Delivery is fire-and-forget.
export type ParentNotifier = {
  enqueue(message: ParentNotifierMessage): void
}

export type CompletionNotifierStore = {
  readonly load: (taskId: string) => TaskRecord | null
  readonly list: () => ListTaskRecordsResult
  readonly replace: (record: TaskRecord) => void
  // Locked re-read + conditional write. Notification bookkeeping MUST go through this so a
  // concurrent residency/host_pid claim is never erased by a stale whole-record replace.
  readonly mutate: (taskId: string, mutation: (record: TaskRecord) => TaskRecord) => TaskRecord | null
  readonly appendEvent: (taskId: string, event: PersistedTaskEvent) => string
}

export type CompletionRetrySchedule = (fn: () => void, delayMs: number) => () => void

export type CompletionNotifierDeps = {
  readonly notifier: ParentNotifier
  readonly store: CompletionNotifierStore
  readonly stateDir?: string
  readonly schedule?: CompletionRetrySchedule
  readonly getParentState?: () => ParentState
  readonly getCurrentSessionId?: () => string | undefined
}

export type CompletionRequest = {
  readonly record: TaskRecord
  readonly parentState: ParentState
  readonly runInBackground: boolean
  readonly tokens?: number
}

export type SkipReason = "sync-task" | "non-notifying-terminal" | "not-terminal" | "already-notified"

export type DeliveredDecision = "wake" | "deliver_streaming"

export type NotifyResult =
  | { readonly kind: "skipped"; readonly reason: SkipReason }
  | { readonly kind: "delivered"; readonly decision: DeliveredDecision }
  | { readonly kind: "buffered"; readonly reason: TransitionReason }
  | { readonly kind: "failed" }

export type FlushInput = {
  readonly sessionId: string
  readonly replaced: boolean
}

export type ReconcileUnnotifiedNotificationsInput = {
  readonly sessionId: string
  readonly parentState: ParentState
}

/** @deprecated Pre-rename alias kept for the omo-senpi caller until todo 18 updates it. */
export type ReconcileFailedNotificationsInput = ReconcileUnnotifiedNotificationsInput

export type FlushResult =
  | { readonly kind: "flushed"; readonly count: number }
  | { readonly kind: "dropped"; readonly count: number }
  | { readonly kind: "failed"; readonly count: number }
  | { readonly kind: "empty" }

export type CompletionNotifier = {
  notifyTerminal(request: CompletionRequest): NotifyResult
  flushBuffered(input: FlushInput): FlushResult
  reconcileUnnotifiedNotifications(input: ReconcileUnnotifiedNotificationsInput): void
  /** Thin alias of reconcileUnnotifiedNotifications for the pre-rename omo-senpi caller (todo 18). */
  reconcileFailedNotifications(input: ReconcileUnnotifiedNotificationsInput): void
  bufferedCount(sessionId: string): number
}

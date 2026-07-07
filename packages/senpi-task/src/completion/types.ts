import type { TaskRecord, TaskStatus } from "../state"
import type { PersistedTaskEvent } from "../store"

// Resolved from omo.json task.notification (config-core OmoTaskNotificationSchema). Kept structural so
// this module stays harness-neutral; the omo-senpi composition (todo 17) feeds the parsed config.
export type NotificationConfig = {
  readonly deliver_as: "steer" | "followUp"
}

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
  | { readonly kind: "deliver_streaming"; readonly deliverAs: "steer" | "followUp" }
  | { readonly kind: "buffer"; readonly reason: TransitionReason }

export type CompletionDetails = {
  readonly task_id: string
  readonly name: string
  readonly status: TaskStatus
  readonly duration_ms: number
  readonly tokens?: number
  readonly final_response_head: string
  readonly continuation_hint: string
}

// Structurally compatible with senpi sendMessage(Pick<CustomMessage,"customType"|"content"|"display"|
// "details">, {triggerTurn, deliverAs}). One message carries one or many completions (batching).
export type ParentNotifierMessage = {
  readonly customType: "senpi-task.completion"
  readonly content: string
  readonly display: boolean
  readonly details: readonly CompletionDetails[]
  readonly triggerTurn?: boolean
  readonly deliverAs?: "steer" | "followUp"
}

// SYNCHRONOUS enqueue seam. senpi pi.sendMessage returns void and swallows async delivery errors, so
// the only observable failure is a synchronous throw from enqueue. Delivery is fire-and-forget.
export type ParentNotifier = {
  enqueue(message: ParentNotifierMessage): void
}

export type CompletionNotifierStore = {
  readonly load: (taskId: string) => TaskRecord | null
  readonly replace: (record: TaskRecord) => void
  readonly appendEvent: (taskId: string, event: PersistedTaskEvent) => string
}

export type CompletionNotifierDeps = {
  readonly notifier: ParentNotifier
  readonly store: CompletionNotifierStore
  readonly config: NotificationConfig
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

export type FlushResult =
  | { readonly kind: "flushed"; readonly count: number }
  | { readonly kind: "dropped"; readonly count: number }
  | { readonly kind: "failed"; readonly count: number }
  | { readonly kind: "empty" }

export type CompletionNotifier = {
  notifyTerminal(request: CompletionRequest): NotifyResult
  flushBuffered(input: FlushInput): FlushResult
  bufferedCount(sessionId: string): number
}

import type { ThreadToolFailure } from "../errors"
import type { BindingRecord, OutboxRow } from "../gateway/bindings"
import type { ThreadModel } from "../gateway/session-models"

// Discriminated result unions. The error branch is shared data, never an exception: a caller
// that sent a malformed payload receives { kind: "error", error: { code: "invalid_arguments" } }.

export type ThreadDataError = { readonly kind: "error"; readonly error: ThreadToolFailure }

export type ThreadStatus = "live" | "resumable"

export type ThreadSummary = {
  readonly thread_id: string
  readonly name: string
  readonly status: ThreadStatus
  readonly cwd: string
  readonly created_at: string
  readonly updated_at: string | null
  /** Present only on a thread listed from disk because its endpoint stopped answering. */
  readonly error_note?: string
  /** The endpoint serving the thread: a host (`rpc_host`, with the session's routing id) or a terminal (`tui`). */
  readonly endpoint?: { readonly kind: "rpc_host" | "tui"; readonly socket: string; readonly routing_id: string | null } | null
  readonly surface?: "tui" | "desktop" | "child" | "daemon" | null
  /** `false` when the endpoint is not answering; the fields then come from the session file. */
  readonly alive?: boolean
  /** #9425: the model the gateway recorded for the thread; null when it neither created nor re-modelled it. */
  readonly model?: ThreadModel | null
}

export type ThreadDelivery =
  | { readonly kind: "steered"; readonly turn_id: string }
  | { readonly kind: "started"; readonly turn_id: string }
  | { readonly kind: "queued"; readonly queue_position: number }
  /** Gateway only: the target has no answering endpoint; the message is durable and its drain takes it on the next start. */
  | { readonly kind: "queued_offline"; readonly queue_position: number }

/**
 * What a send through the session gateway adds to a delivery result: the durable `delivery_id`, the
 * lane the target used (`steer` / `follow_up`, or the requested mode while it waits), and the kind
 * of endpoint that serves the target (null when none answered).
 */
export type ThreadGatewayDeliveryFacts = {
  readonly delivery_id?: string
  readonly effective_mode?: "auto" | "steer" | "follow_up"
  readonly endpoint?: { readonly kind: "rpc_host" | "tui" } | null
}

export type ThreadAddressResolution = "id" | "exact_name" | "fuzzy"

export type ThreadReadSource = "live_host" | "session_jsonl"

export type ThreadTranscriptItem = {
  readonly seq: number
  readonly role: "user" | "assistant" | "tool" | "system"
  readonly content: string
}

export type ThreadCreateResult =
  | { readonly kind: "ok"; readonly thread: ThreadSummary; readonly deduplicated: boolean }
  | ThreadDataError

export type ThreadListResult =
  | { readonly kind: "ok"; readonly threads: readonly ThreadSummary[]; readonly scope: "workspace" | "all" }
  | ThreadDataError

export type ThreadReadResult =
  | {
      readonly kind: "ok"
      readonly thread_id: string
      readonly items: readonly ThreadTranscriptItem[]
      readonly truncated: boolean
      readonly next_cursor?: string
      readonly source: ThreadReadSource
      /** Set on the JSONL fallback for a thread whose endpoint is dead: the file may lag the session. */
      readonly source_incomplete?: boolean
      readonly error_note?: string
      readonly model?: ThreadModel | null
    }
  | ThreadDataError

export type ThreadSendResult =
  | ({
      readonly kind: "ok"
      readonly thread_id: string
      readonly delivery: ThreadDelivery
      readonly message_seq: number
      readonly deduplicated: boolean
    } & ThreadGatewayDeliveryFacts)
  | ThreadDataError

export type ThreadInterruptResult =
  | { readonly kind: "ok"; readonly thread_id: string; readonly turn_id?: string; readonly interrupted: boolean }
  | ThreadDataError

export type ThreadHandoffResult =
  | ({
      readonly kind: "ok"
      readonly thread: ThreadSummary
      readonly resolved_by: ThreadAddressResolution
      readonly delivery: ThreadDelivery
      readonly message_seq: number
      readonly deduplicated: boolean
    } & ThreadGatewayDeliveryFacts)
  | ThreadDataError

export type ThreadThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

export type ThreadReasoningScope = "session" | "turn"

export type ThreadRenameResult =
  | { readonly kind: "ok"; readonly thread_id: string; readonly name: string }
  | ThreadDataError

export type ThreadSetModelResult =
  | { readonly kind: "ok"; readonly thread_id: string; readonly model: { readonly provider: string; readonly id: string } }
  | ThreadDataError

export type ThreadSetReasoningResult =
  | { readonly kind: "ok"; readonly thread_id: string; readonly level: ThreadThinkingLevel; readonly scope: ThreadReasoningScope }
  | ThreadDataError

export type ThreadBinding = BindingRecord

export type ThreadOutboxRow = OutboxRow

export type ThreadBindResult = { readonly kind: "ok"; readonly binding: ThreadBinding; readonly deduplicated: boolean } | ThreadDataError

export type ThreadUnbindResult =
  | {
      readonly kind: "ok"
      readonly binding: ThreadBinding
      /** True when the binding was already detached or expired: the call replays success and changes nothing. */
      readonly already_closed: boolean
      /** Deliveries accepted through this binding that the session has not taken yet. */
      readonly in_flight: readonly string[]
      readonly deduplicated: boolean
    }
  | ThreadDataError

export type ThreadRebindResult =
  | {
      readonly kind: "ok"
      readonly binding: ThreadBinding
      /** Deliveries queued under the old revision, closed with a binding_closed refusal instead of being moved. */
      readonly closed: readonly string[]
      readonly deduplicated: boolean
    }
  | ThreadDataError

export type ThreadBindingsResult = { readonly kind: "ok"; readonly bindings: readonly ThreadBinding[]; readonly next_cursor: string | null } | ThreadDataError

export type ThreadReportResult =
  | {
      readonly kind: "ok"
      readonly binding_id: string
      readonly revision: number
      readonly event: "milestone" | "report" | "question" | "completion"
      /** The outbox row written; null for a completion, which is written when the session settles. */
      readonly cursor: number | null
      readonly reply_token: string | null
      readonly armed: boolean
      readonly deduplicated: boolean
    }
  | ThreadDataError

export type ThreadOutboxResult =
  | {
      readonly kind: "ok"
      readonly binding_id: string
      readonly revision: number
      readonly status: ThreadBinding["status"]
      readonly rows: readonly ThreadOutboxRow[]
      readonly next_cursor: number
      readonly acked_cursor: number
    }
  | ThreadDataError

export type ThreadOutboxAckResult = { readonly kind: "ok"; readonly binding_id: string; readonly acked_cursor: number; readonly changed: boolean } | ThreadDataError

export type ThreadAnswerResult = { readonly kind: "ok"; readonly binding_id: string; readonly cursor: number; readonly session_durable_id: string } | ThreadDataError

export type ThreadToolResult =
  | ThreadBindResult
  | ThreadUnbindResult
  | ThreadRebindResult
  | ThreadBindingsResult
  | ThreadReportResult
  | ThreadOutboxResult
  | ThreadOutboxAckResult
  | ThreadAnswerResult
  | ThreadCreateResult
  | ThreadListResult
  | ThreadReadResult
  | ThreadSendResult
  | ThreadInterruptResult
  | ThreadHandoffResult
  | ThreadRenameResult
  | ThreadSetModelResult
  | ThreadSetReasoningResult

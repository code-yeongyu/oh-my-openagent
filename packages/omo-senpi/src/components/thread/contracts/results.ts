import type { ThreadToolFailure } from "../errors"

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
  readonly updated_at: string
}

export type ThreadDelivery =
  | { readonly kind: "steered"; readonly turn_id: string }
  | { readonly kind: "started"; readonly turn_id: string }
  | { readonly kind: "queued"; readonly queue_position: number }

export type ThreadAddressResolution = "id" | "exact_name" | "fuzzy"

export type ThreadReadSource = "live_host" | "session_jsonl"

export type ThreadTranscriptItem = {
  readonly seq: number
  readonly role: "user" | "assistant" | "system"
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
    }
  | ThreadDataError

export type ThreadSendResult =
  | {
      readonly kind: "ok"
      readonly thread_id: string
      readonly delivery: ThreadDelivery
      readonly message_seq: number
      readonly deduplicated: boolean
    }
  | ThreadDataError

export type ThreadInterruptResult =
  | { readonly kind: "ok"; readonly thread_id: string; readonly turn_id?: string; readonly interrupted: boolean }
  | ThreadDataError

export type ThreadHandoffResult =
  | {
      readonly kind: "ok"
      readonly thread: ThreadSummary
      readonly resolved_by: ThreadAddressResolution
      readonly delivery: ThreadDelivery
      readonly message_seq: number
      readonly deduplicated: boolean
    }
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

export type ThreadToolResult =
  | ThreadCreateResult
  | ThreadListResult
  | ThreadReadResult
  | ThreadSendResult
  | ThreadInterruptResult
  | ThreadHandoffResult
  | ThreadRenameResult
  | ThreadSetModelResult
  | ThreadSetReasoningResult

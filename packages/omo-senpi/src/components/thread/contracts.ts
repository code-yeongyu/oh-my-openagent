import { Value } from "typebox/value"
import { type Static, type TObject, Type } from "typebox"

import { type ThreadToolFailure, threadToolFailure } from "./errors"

export const THREAD_MESSAGE_MAX_BYTES = 32768
export const THREAD_SUMMARY_MAX_LENGTH = 200
export const THREAD_READ_DEFAULT_BYTES = 131072
export const THREAD_READ_MAX_BYTES = 1048576

const ThreadAddress = Type.String({
  description:
    "Recipient thread id or unique name as returned by thread_list; a name shared by several threads returns ambiguous_target with candidates.",
})

const AllScope = Type.Optional(
  Type.Boolean({
    description:
      "Address threads in every workspace on this machine instead of only the caller's workspace; left unset, an exact id from another workspace returns scope_denied.",
  }),
)

const IdempotencyKey = Type.Optional(
  Type.String({
    description:
      "Caller-chosen key that makes a retried call return the earlier result instead of repeating the side effect; reusing the key with different arguments returns idempotency_conflict.",
  }),
)

const ExpectedTurnId = Type.Optional(
  Type.String({
    description:
      "Turn id the steer applies to; required with delivery steer, and a changed active turn returns turn_conflict with the message held undelivered.",
  }),
)

const Summary = Type.Optional(
  Type.String({
    maxLength: THREAD_SUMMARY_MAX_LENGTH,
    description: "One-line preview shown to the caller when the completion notice arrives.",
  }),
)

const Message = Type.String({
  maxLength: THREAD_MESSAGE_MAX_BYTES,
  description: `Instruction to deliver to the target thread; longer than ${THREAD_MESSAGE_MAX_BYTES} UTF-8 bytes returns message_too_large.`,
})

// R6: an enum instead of a boolean because delivery has three plausible states.
export const ThreadDeliveryMode = Type.Union([Type.Literal("auto"), Type.Literal("steer"), Type.Literal("follow_up")], {
  description:
    "auto steers the running turn when one is active and starts a new turn otherwise; steer requires expected_turn_id and becomes turn_conflict when the active turn changed; follow_up queues the message behind the running turn.",
})

export const ThreadCreateParams = Type.Object({
  name: Type.Optional(
    Type.String({
      description:
        "Display label for the new thread; an existing thread with the same normalized name returns name_conflict, and later renames change only the label while thread_id stays the address.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description: "Working directory the new thread runs in; leaving it unset keeps the thread inside the caller's workspace.",
    }),
  ),
  fork_from: Type.Optional(
    Type.String({
      description: "Durable id of an existing thread to fork; the new thread starts with that transcript as prior context.",
    }),
  ),
  idempotency_key: IdempotencyKey,
})

export const ThreadListParams = Type.Object({
  all_scope: Type.Optional(
    Type.Boolean({
      description: "List threads from every workspace on this machine; the default scope returns only the caller's workspace.",
    }),
  ),
})

export const ThreadReadParams = Type.Object({
  thread: ThreadAddress,
  cursor: Type.Optional(
    Type.String({
      description:
        "Opaque cursor from an earlier thread_read to continue a truncated transcript; a transcript revision that moved past it returns cursor_stale.",
    }),
  ),
  max_bytes: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: THREAD_READ_MAX_BYTES,
      description: `Byte budget for the returned transcript slice, default ${THREAD_READ_DEFAULT_BYTES} and capped at ${THREAD_READ_MAX_BYTES}; a longer transcript returns truncated with next_cursor.`,
    }),
  ),
  all_scope: AllScope,
})

export const ThreadSendParams = Type.Object({
  thread: ThreadAddress,
  message: Message,
  delivery: Type.Optional(ThreadDeliveryMode),
  expected_turn_id: ExpectedTurnId,
  summary: Summary,
  idempotency_key: IdempotencyKey,
  all_scope: AllScope,
})

export const ThreadInterruptParams = Type.Object({
  thread: ThreadAddress,
  turn_id: Type.Optional(
    Type.String({
      description: "Running turn to stop, defaulting to the newest running turn; interrupting an idle thread returns success with interrupted false.",
    }),
  ),
  all_scope: AllScope,
})

export const ThreadHandoffParams = Type.Object({
  thread: Type.String({
    description:
      "Thread id or name to reopen after a pause; the fuzzy resolver also accepts partial names and workspace basenames, and a close runner-up returns ambiguous_target with candidates.",
  }),
  match: Type.Optional(
    Type.Union([Type.Literal("exact"), Type.Literal("fuzzy")], {
      description:
        "exact resolves a thread id or a unique name; fuzzy additionally ranks partial names and workspace basenames and returns the top match only when it clearly leads its runner-up.",
    }),
  ),
  message: Message,
  delivery: Type.Optional(ThreadDeliveryMode),
  expected_turn_id: ExpectedTurnId,
  summary: Summary,
  idempotency_key: IdempotencyKey,
  all_scope: AllScope,
})

export type ThreadCreateInput = Static<typeof ThreadCreateParams>
export type ThreadListInput = Static<typeof ThreadListParams>
export type ThreadReadInput = Static<typeof ThreadReadParams>
export type ThreadSendInput = Static<typeof ThreadSendParams>
export type ThreadInterruptInput = Static<typeof ThreadInterruptParams>
export type ThreadHandoffInput = Static<typeof ThreadHandoffParams>

export const threadToolParamSchemas = {
  thread_create: ThreadCreateParams,
  thread_list: ThreadListParams,
  thread_read: ThreadReadParams,
  thread_send: ThreadSendParams,
  thread_interrupt: ThreadInterruptParams,
  thread_handoff: ThreadHandoffParams,
} as const

export type ThreadToolName = keyof typeof threadToolParamSchemas

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

export type ThreadToolResult =
  | ThreadCreateResult
  | ThreadListResult
  | ThreadReadResult
  | ThreadSendResult
  | ThreadInterruptResult
  | ThreadHandoffResult

export type ThreadParamParse<S extends TObject> =
  | { readonly kind: "ok"; readonly value: Static<S> }
  | ThreadDataError

// Validation seam: parse a thread tool payload against its schema and return the outcome as
// data. Invalid input yields the invalid_arguments failure object here instead of throwing,
// so tool runners can hand it straight to the model.
export function parseThreadParams<S extends TObject>(schema: S, input: unknown): ThreadParamParse<S> {
  if (Value.Check(schema, input)) {
    return { kind: "ok", value: input as Static<S> }
  }
  const [first] = Value.Errors(schema, input)
  return {
    kind: "error",
    error: threadToolFailure(
      "invalid_arguments",
      `Parameter validation failed at ${first?.instancePath ?? "/"}: ${first?.message ?? "invalid value"}`,
      "Fix the flagged field and call the tool again with a valid payload.",
    ),
  }
}

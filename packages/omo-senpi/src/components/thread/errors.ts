// Thread tool failure taxonomy. Every thread tool returns failures as data (kind:"error"),
// never as an exception, and every failure names the next action so the caller can recover
// in one step (authoring rule R7).

export const THREAD_ERROR_CODES = [
  "invalid_arguments",
  "caller_context_missing",
  "not_found",
  "ambiguous_target",
  "scope_denied",
  "name_conflict",
  "not_resumable",
  "orphaned",
  "foreign_live_owner",
  "no_active_turn",
  "turn_conflict",
  "not_steerable",
  "message_too_large",
  "queue_full",
  "cursor_invalid",
  "cursor_stale",
  "idempotency_conflict",
  "idempotency_in_progress",
  "idempotency_uncertain",
  "approval_unavailable",
  "approval_route_locked",
  "partial_commit",
  "unsupported",
  "overloaded",
  "transport_closed",
  "internal_error",
] as const

export type ThreadErrorCode = (typeof THREAD_ERROR_CODES)[number]

const CODE_SET: ReadonlySet<string> = new Set(THREAD_ERROR_CODES)

export function isThreadErrorCode(value: unknown): value is ThreadErrorCode {
  return typeof value === "string" && CODE_SET.has(value)
}

// The data-shaped failure every thread tool returns on the error branch of its result union.
// `next_action` is the recovery prompt for the model; `details` carries structured payloads
// such as the candidate list for ambiguous_target.
export type ThreadToolFailure = {
  readonly code: ThreadErrorCode
  readonly message: string
  readonly next_action: string
  readonly details?: Readonly<Record<string, unknown>>
}

export function threadToolFailure(
  code: ThreadErrorCode,
  message: string,
  nextAction: string,
  details?: Readonly<Record<string, unknown>>,
): ThreadToolFailure {
  if (!isThreadErrorCode(code)) {
    throw new Error(`unknown thread error code: ${String(code)}`)
  }
  return { code, message, next_action: nextAction, ...(details === undefined ? {} : { details }) }
}

// Thread tool failure taxonomy. Every thread tool returns failures as data (kind:"error"),
// never as an exception, and every failure names the next action so the caller can recover
// in one step (authoring rule R7).

export const THREAD_ERROR_CODES = [
  "invalid_arguments",
  "caller_context_missing",
  "not_found",
  "reply_target_mismatch",
  "ambiguous_target",
  "scope_denied",
  "name_conflict",
  "not_resumable",
  "orphaned",
  "foreign_live_owner",
  "no_active_turn",
  "turn_conflict",
  "turn_active",
  "not_steerable",
  "message_too_large",
  "queue_full",
  "cursor_invalid",
  "cursor_stale",
  "idempotency_conflict",
  "idempotency_in_progress",
  "idempotency_uncertain",
  "delivered_unconfirmed",
  "approval_unavailable",
  "approval_route_locked",
  "partial_commit",
  "unsupported",
  "overloaded",
  "transport_closed",
  "host_unavailable",
  "internal_error",
  "model_not_found",
  "model_ambiguous",
  "thinking_level_unsupported",
  "loop_detected",
  "chain_count_limit",
  "binding_conflict",
  "binding_mismatch",
  "binding_inactive",
  "stale_revision",
  "stale_token",
  "already_answered",
  "answer_in_progress",
  "device_offline",
  "relay_requires_paid_plan",
  "alias_taken",
  "gateway_schema_too_new",
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

/**
 * The gateway store refuses to open because a newer omo build on this machine already migrated it past the schema this
 * build knows (`gateway/schema.ts` `GatewaySchemaVersionError`, carried across the store worker with its `details`).
 * The refusal stands, since reading a newer schema could corrupt it; this turns it into the one failure that names
 * both versions and the remedy. Any other error answers undefined.
 */
export function gatewaySchemaRefusal(error: unknown): ThreadToolFailure | undefined {
  const { code, details } = (error ?? {}) as {
    code?: unknown
    details?: { found?: unknown; supported?: unknown; extension?: unknown }
  }
  if (
    code !== "gateway_schema_too_new" ||
    typeof details?.found !== "number" ||
    typeof details.supported !== "number" ||
    details.extension !== undefined
  )
    return undefined
  const command = UPDATE_COMMAND
  return threadToolFailure(
    "gateway_schema_too_new",
    `This omo build reads gateway schema ${details.supported}, but this machine's gateway store is at schema ${details.found}: a newer omo build already upgraded it. Nothing was sent or changed.`,
    `Update omo with \`${command}\`, restart this session, then retry.`,
    { gateway_schema: details.found, binary_schema: details.supported, update_command: command },
  )
}

/**
 * The one command that updates any omo build: a release updates itself, a source build answers with its own rebuild command
 * (omo-native `compile-entry.ts`). Nothing in the environment can name a better one: the engine strips `SENPI_BRAND` at
 * startup and the `omo thread` CLI runs in the launcher, which never has it.
 */
const UPDATE_COMMAND = "omo update"

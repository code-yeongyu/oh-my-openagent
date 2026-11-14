import { LocalApiError } from "@oh-my-opencode/device-service-core"
import { THREAD_ERROR_CODES } from "../thread/errors"
import type { RemoteFailure } from "./types"

/**
 * The one code list of the remote module (design v8-core r2, B1): the thread taxonomy's codes with their names unchanged
 * (thread/errors.ts), plus exactly the five below. `unsupported` is reused with `details.feature`.
 */
export const REMOTE_CODES = [
  ...THREAD_ERROR_CODES,
  "timeout",
  "cancelled",
  "session_ended",
  "sender_not_allowed",
  "local_only",
] as const
export type RemoteCode = (typeof REMOTE_CODES)[number]

export const remoteFailure = (
  code: RemoteCode,
  message: string,
  next_action: string,
  extra: Omit<RemoteFailure, "kind" | "code" | "message" | "next_action"> = {},
): RemoteFailure => ({ kind: "error", code, message, next_action, ...extra })

type LocalApiCode = LocalApiError["code"]
type Mapped = { readonly code: RemoteCode; readonly details?: Readonly<Record<string, unknown>> }

// How every code the local API (L0) or the device service raises reaches a caller. Typed over the whole vocabulary, so a
// code the vendored client adds fails the typecheck here. The four lines the design names: handshake_timeout and closed
// are host_unavailable, request_timeout is timeout (uncertain when it may have run, see failureFromError).
const LOCAL_API_CODES: Readonly<Record<LocalApiCode, Mapped>> = {
  handshake_timeout: { code: "host_unavailable" },
  request_timeout: { code: "timeout" },
  closed: { code: "host_unavailable" },
  insecure_state_dir: { code: "host_unavailable" },
  server_proof_invalid: { code: "host_unavailable" },
  refused: { code: "host_unavailable" },
  read_failed: { code: "host_unavailable" },
  host_not_answering: { code: "host_unavailable" },
  signed_out: { code: "host_unavailable" },
  sign_in_required: { code: "host_unavailable" },
  service_disabled: { code: "host_unavailable" },
  activation_pending: { code: "host_unavailable" },
  authorization_stale: { code: "host_unavailable" },
  device_mismatch: { code: "host_unavailable" },
  device_changed: { code: "host_unavailable" },
  account_changed: { code: "host_unavailable" },
  device_key_invalid: { code: "host_unavailable" },
  owner_transfer: { code: "host_unavailable" },
  unauthenticated: { code: "host_unavailable" },
  client_proof_invalid: { code: "host_unavailable" },
  plan_required: { code: "relay_requires_paid_plan" },
  forbidden: { code: "scope_denied" },
  peer_not_found: { code: "not_found", details: { kind: "device" } },
  peer_not_session_client: { code: "not_found", details: { kind: "device" } },
  session_not_found: { code: "not_found", details: { kind: "session" } },
  not_attached: { code: "not_found", details: { kind: "handle" } },
  message_too_long: { code: "message_too_large" },
  upload_incomplete: { code: "invalid_arguments" },
  invalid_request: { code: "unsupported" },
  unknown_type: { code: "unsupported" },
  malformed: { code: "unsupported" },
  method_unclassified: { code: "unsupported" },
  method_local_only: { code: "unsupported" },
  unsupported: { code: "unsupported" },
  engine_too_old: { code: "unsupported" },
  command_id_conflict: { code: "idempotency_conflict" },
  protocol_violation: { code: "internal_error" },
  internal: { code: "internal_error" },
}

// The engine's own failure codes that are renamed on the way up (B1 mappings, R-05 restored). Every other engine code
// keeps its name when it is already a remote code.
const ENGINE_CODES: Readonly<Record<string, Mapped>> = {
  model_unavailable: { code: "model_not_found" },
  invalid_level: { code: "thinking_level_unsupported" },
  worktree_failed: { code: "unsupported", details: { feature: "worktree" } },
  not_running: { code: "not_resumable" },
  handle_lost: { code: "not_found", details: { kind: "handle" } },
}

/** `model_unavailable` becomes `model_ambiguous` when the host names candidates (B1). */
export const engineCode = (code: string, candidates?: readonly string[]): Mapped =>
  code === "model_unavailable" && candidates !== undefined && candidates.length > 0
    ? { code: "model_ambiguous", details: { candidates } }
    : (ENGINE_CODES[code] ?? { code: "unsupported", details: { engine_code: code } })

// Each next action names an SDK operation, never a CLI verb: the CLI renderer adds the verb (B1, R7).
const NEXT_ACTION: Partial<Record<RemoteCode, string>> = {
  host_unavailable: "Call service.status to see why the device service cannot serve this, then retry.",
  relay_requires_paid_plan: "The account's plan has no relay; upgrade it, then call service.status.",
  timeout: "Retry the call; if it changes something, read the current state first.",
  cancelled: "Call it again if it is still wanted.",
  not_found: "Call devices.list or sessions.list for the current ids.",
  scope_denied: "Call service.status for the device service's state; this client may not make this call.",
  unsupported: "Update omo and the device service, then retry.",
  message_too_large: "Send less in one call.",
  idempotency_conflict: "Retry with a new idempotency key.",
  internal_error: "Retry; if it fails again, report it with the details.",
  invalid_arguments: "Fix the arguments and call it again.",
}

export const nextActionFor = (code: RemoteCode): string => NEXT_ACTION[code] ?? "Retry the call."

/**
 * A thrown error from L0/L1 as a typed failure. `mutating`: the call may have changed something on the service, so a
 * timeout or cancellation after it was sent is uncertain.
 */
export const failureFromError = (error: unknown, mutating: boolean): RemoteFailure => {
  if (!(error instanceof LocalApiError))
    return remoteFailure(
      "host_unavailable",
      `The device service did not answer: ${error instanceof Error ? error.message : String(error)}.`,
      nextActionFor("host_unavailable"),
    )
  const mapped = LOCAL_API_CODES[error.code]
  const uncertain = mapped.code === "timeout" && (mutating || error.command_id !== undefined)
  return remoteFailure(mapped.code, `${error.code}: ${error.reason}`, nextActionFor(mapped.code), {
    ...(uncertain ? { uncertain: true } : {}),
    ...(error.command_id === undefined ? {} : { command_id: error.command_id }),
    details: {
      ...mapped.details,
      local_api_code: error.code,
      ...(error.action === null ? {} : { action: error.action }),
    },
  })
}

/**
 * Exit codes (B1): 0 ok, 1 a typed refusal, 3 unavailable (host_unavailable, relay_requires_paid_plan, the
 * device service not installed), 4 session_ended, 124 timeout, 130 cancelled. 2 (usage) is the CLI's own, never a failure.
 */
export const exitCodeOf = (failure: RemoteFailure | undefined): 0 | 1 | 3 | 4 | 124 | 130 => {
  if (failure === undefined) return 0
  switch (failure.code) {
    case "host_unavailable":
    case "relay_requires_paid_plan":
      return 3
    case "session_ended":
      return 4
    case "timeout":
      return 124
    case "cancelled":
      return 130
    default:
      return 1
  }
}

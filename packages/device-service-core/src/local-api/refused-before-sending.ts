import type { LocalApiError } from "./errors.ts"

// The local API codes that answer a session.command before anything leaves this device: the owner's error responses
// (dispatch outcomes arrive as session.command_state, never as an error response) and the client's own size check.
// Everything else - `closed` and `protocol_violation` can fail a command already written to the connection, and
// `internal` proves nothing about dispatch - may have run on the other device, so it is never reported as refused.
export const REFUSED_BEFORE_SENDING: ReadonlySet<LocalApiError["code"]> = new Set<LocalApiError["code"]>([
  "unauthenticated",
  "client_proof_invalid",
  "invalid_request",
  "unknown_type",
  "forbidden",
  "owner_transfer",
  "signed_out",
  "device_mismatch",
  "device_changed",
  "account_changed",
  "device_key_invalid",
  "service_disabled",
  "sign_in_required",
  "plan_required",
  "activation_pending",
  "authorization_stale",
  "peer_not_found",
  "peer_not_session_client",
  "session_not_found",
  "engine_too_old",
  "not_attached",
  "command_id_conflict",
  "message_too_long",
  "upload_incomplete",
  "malformed",
  "method_unclassified",
  "method_local_only",
  "host_not_answering",
  "unsupported",
])

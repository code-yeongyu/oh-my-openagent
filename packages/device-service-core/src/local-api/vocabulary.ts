// The value lists of the local API v1 vocabulary. Every name and value here is generic: none contains a
// transport-internal word (docs/local-api.md "Wording"); LA18 scans this file, protocol.ts and the docs.
export const LOCAL_API_VERSION = 1;

export const STATUS_STATES = [
  "not_configured",
  "disabled",
  "sign_in_required",
  "plan_required",
  "keychain_locked",
  "connecting",
  "activation_pending",
  "connected",
  "offline",
  "authorization_stale",
  "service_degraded",
  "update_required",
  "signed_out",
] as const;
export type StatusState = (typeof STATUS_STATES)[number];
export const POLICY_STATES = ["off", "pending", "active"] as const;
export type PolicyState = (typeof POLICY_STATES)[number];
export const THIS_DEVICE_STATES = [
  "unclassified",
  "desktop_unregistered",
  "indeterminate",
  "desktop",
  "cli_only",
  "acked",
] as const;
export type ThisDeviceState = (typeof THIS_DEVICE_STATES)[number];

export const CLIENT_NAMES = ["desktop", "omo", "installer"] as const;
export type ClientName = (typeof CLIENT_NAMES)[number];
export const CAPABILITIES = ["sessions", "devices", "enforcement", "upgrade"] as const;
export type Capability = (typeof CAPABILITIES)[number];
export const REFUSED_REASONS = ["version", "data_home_required", "malformed"] as const;
export type RefusedReason = (typeof REFUSED_REASONS)[number];

export const ROUND_STATES = ["open", "done"] as const;
export type RoundState = (typeof ROUND_STATES)[number];
export const ROUND_DEVICE_STATES = [
  "answered",
  "pending",
  "undelivered",
  "page_cap",
  "cursor_echo",
  "timed_out",
  "skipped",
] as const;
export type RoundDeviceState = (typeof ROUND_DEVICE_STATES)[number];
export const LISTING_SOURCES = ["live", "cache"] as const;
export type ListingSource = (typeof LISTING_SOURCES)[number];
// The session states a listing row carries, and the filter keys sessions.list accepts (both equal the shared
// session-list contract's lists; a drift test pins them).
export const SESSION_ROW_STATES = ["running", "idle", "ended"] as const;
export type SessionRowState = (typeof SESSION_ROW_STATES)[number];
export const FILTER_KEYS = ["device", "project", "state"] as const;

export const BLOB_OF = ["state", "record", "entry"] as const;
export type BlobOf = (typeof BLOB_OF)[number];
export const BLOB_ABORT_REASONS = [
  "digest_mismatch",
  "source_gone",
  "too_large",
  "detached",
] as const;
export type BlobAbortReason = (typeof BLOB_ABORT_REASONS)[number];
export const UPLOAD_ABORT_REASONS = [
  "message_too_long",
  "parts_conflict",
  "malformed",
  "detached",
] as const;
export type UploadAbortReason = (typeof UPLOAD_ABORT_REASONS)[number];
export const DETACH_REASONS = [
  "authorization_expired",
  "activation_pending",
  "service_disabled",
  "owner_transfer",
  "peer_revoked",
  "stream_key_pending",
  "peer_detached",
  "blob_failed",
] as const;
export type DetachReason = (typeof DETACH_REASONS)[number];
export const ATTACH_PENDING_REASONS = ["stream_key_pending"] as const;
export type AttachPendingReason = (typeof ATTACH_PENDING_REASONS)[number];

// Commands: the ops, the sender-ledger states with the evidence rule, and the reasons (equal to the shared
// command contract's lists; a drift test pins them). A command_id is exactly 22 base64url characters.
export const COMMAND_ID_CHARS = 22;
export const COMMAND_OPS = ["prompt", "steer", "abort", "permission", "question"] as const;
export type CommandOp = (typeof COMMAND_OPS)[number];
export const COMMAND_STATES = [
  "queued",
  "transport_confirmed",
  "not confirmed",
  "not delivered: never_sent",
  "engine_dispatched",
  "engine_applied",
  "engine_refused",
  "engine_stale",
  "uncertain",
] as const;
export type CommandState = (typeof COMMAND_STATES)[number];
export const COMMAND_UNCERTAIN_REASONS = [
  "request_gone",
  "no_receipt",
  "engine_restarted",
  "recipient_revoked",
  "transport_expired",
  "unconfirmed",
] as const;
export const COMMAND_REFUSAL_REASONS = [
  "parts_conflict",
  "peer_unauthorized",
  "message_too_long",
  "engine_capability_missing",
] as const;
export type CommandUncertainReason = (typeof COMMAND_UNCERTAIN_REASONS)[number];
export type CommandRefusalReason = (typeof COMMAND_REFUSAL_REASONS)[number];
export type CommandReason = CommandUncertainReason | CommandRefusalReason;
// Only a retry by the sender can help, and only when the recipient provably cannot hold the command.
export const RETRYABLE_STATES: readonly CommandState[] = [
  "not confirmed",
  "not delivered: never_sent",
];

// The codes of an error response. Each response error also carries a diagnostic reason and the one action the
// user can take, or null when there is none.
export const ERROR_CODES = [
  "unauthenticated",
  "client_proof_invalid",
  "invalid_request",
  "unknown_type",
  "forbidden",
  "owner_transfer",
  "internal",
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
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
// Errors the client library raises itself, before or instead of a server answer.
export const CLIENT_ERROR_CODES = [
  "insecure_state_dir",
  "server_proof_invalid",
  "refused",
  "protocol_violation",
  "closed",
  "message_too_long",
  "read_failed",
  "handshake_timeout",
  "request_timeout",
] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

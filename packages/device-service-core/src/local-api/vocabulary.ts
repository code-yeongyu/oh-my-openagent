// Vendored from sisyphuslabs/omo-relay-daemon@4ed58920002306a95bf92fe99ca448be89d7103f packages/local-api/src/vocabulary.ts
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
  // #829 P1 (design B.4): the update record on disk violates its invariant; the service starts nothing but its local API.
  "fail_closed",
] as const;
export type StatusState = (typeof STATUS_STATES)[number];
// #829 P2: the update record's phase a candidate reports in status.get update (trial until the installer commits it).
export const STATUS_UPDATE_PHASES = ["trial", "committed"] as const;
export type StatusUpdatePhase = (typeof STATUS_UPDATE_PHASES)[number];
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

// "sdk": a program built on the machine SDK (design 8.4); like "omo", it carries no data_home.
export const CLIENT_NAMES = ["desktop", "omo", "installer", "sdk"] as const;
export type ClientName = (typeof CLIENT_NAMES)[number];
export const CAPABILITIES = ["sessions", "devices", "enforcement", "upgrade", "control"] as const;
// #267: a service that serves machine operations also lists "machine"; one that does not answers every machine.*
// request unsupported.
export const OPTIONAL_CAPABILITIES = ["machine"] as const;
export type Capability = (typeof CAPABILITIES)[number] | (typeof OPTIONAL_CAPABILITIES)[number];
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
  // 0013 amendment 2026-11-03: the host's engine closed or replaced the attached session (attach_ended). Gated by
  // client version (event-gate.ts): an older client gets peer_detached.
  "session_closed",
  "session_replaced",
] as const;
export type DetachReason = (typeof DETACH_REASONS)[number];
// #829 P3: host.update_notice, the step of a runtime update the host tells its attached viewers, and the drain policy.
export const UPDATE_NOTICE_PHASES = [
  "draining",
  "final",
  "updated",
  "rolled_back",
  "failed",
] as const;
export type UpdateNoticePhase = (typeof UPDATE_NOTICE_PHASES)[number];
export const UPDATE_POLICIES = ["defer", "force", "ask"] as const;
export type UpdatePolicy = (typeof UPDATE_POLICIES)[number];

export const ATTACH_PENDING_REASONS = ["stream_key_pending"] as const;
export type AttachPendingReason = (typeof ATTACH_PENDING_REASONS)[number];

// Commands: the sender-ledger states with the evidence rule, and the reasons (each one the shared command contract's;
// a drift test pins them). A command_id is exactly 22 base64url characters.
export const COMMAND_ID_CHARS = 22;
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
  // Decision 0010 (tool calls on a hand) and 0018 (an engine reply over RECORD_MAX_BYTES): every host reason travels.
  "lease_expired",
  "cancelled",
  "hand_restarted",
  "result_expired",
  "record_too_large",
  // Decision 0018 amendment (2026-11-04, #422): a result the receiver could not decode; only to a command that asked.
  "result_undecodable",
] as const;
export const COMMAND_REFUSAL_REASONS = [
  "parts_conflict",
  "peer_unauthorized",
  "message_too_long",
  "engine_capability_missing",
  // Decision 0011: the receiving endpoint's refusals of a forwarded engine RPC record, in its order (#105).
  "malformed",
  "method_unclassified",
  "method_local_only",
  "capability_missing",
  // Decisions 0010, #123 and SP6: every refusal reason the spec defines reaches the client as itself.
  "schema_stale",
  "tool_unknown",
  "cancelled",
  "hand_restarted",
  "scope_unknown",
  "scope_closed",
  "epoch_fenced",
  "epoch_step_exceeded",
  // Decision 0018 section 5 (amended 2026-11-04): a delegated command whose route the host does not list.
  "route_unlisted",
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
  // #393 part B: an alias (a session title) matched more than one session; the error names every candidate.
  "session_ambiguous",
  "engine_too_old",
  "not_attached",
  "command_id_conflict",
  "message_too_long",
  "upload_incomplete",
  // The receiver refusals the service can decide before anything leaves the device (#105).
  "malformed",
  "method_unclassified",
  "method_local_only",
  // Decision 0013: a held session.attach whose host did not answer within its bound. Retryable; see error-gate.ts.
  "host_not_answering",
  // #267: this service defines the request but does not serve it yet (machine operations before their executor).
  "unsupported",
  // omo#13037 A5.1: a delivery.answer whose (sender_device, command_id) pair no waiting hand-off has; nothing is applied.
  "unknown_delivery",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
// #393 part B: why a device's listing could not settle an alias (an incomplete entry on session_not_found).
export const ALIAS_INCOMPLETE_REASONS = [
  "cache",
  "timed_out",
  "undelivered",
  "skipped",
  "stopped",
] as const;
export type AliasIncompleteReason = (typeof ALIAS_INCOMPLETE_REASONS)[number];
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
// Why the refresher path rule refused a refresher.register; travels as path_refusal on a forbidden answer only.
export const PATH_REFUSAL_PROBLEMS = [
  "not_absolute",
  "not_found",
  "not_regular_file",
  "not_executable",
  "foreign_owner",
  "group_writable",
  "world_writable",
  "windows_acl",
] as const;
export type PathRefusalProblem = (typeof PATH_REFUSAL_PROBLEMS)[number];

// Machine operations (#267, design 9.3): a client asks the service to run operations on one of the account's devices.
// An op's states mirror the command ledger's: queued, transport_confirmed, then the outcome on the target device;
// link_down is transient (the path to the device is down; the op keeps its place and resumes).
export const MACHINE_OP_STATES = [
  "queued",
  "transport_confirmed",
  "host_dispatched",
  "host_applied",
  "link_down",
] as const;
export type MachineOpState = (typeof MACHINE_OP_STATES)[number];
// A device as a machine target: reachable and serving machine operations, unreachable, or on a build without them.
export const MACHINE_STATES = ["online", "offline", "unsupported"] as const;
export type MachineState = (typeof MACHINE_STATES)[number];
// What machine.result_of knows about an op_id: still running, settled (its result follows as an event), or never seen.
export const MACHINE_LOOKUP_STATES = ["in_flight", "terminal", "unknown"] as const;
export type MachineLookupState = (typeof MACHINE_LOOKUP_STATES)[number];
export const MACHINE_BLOB_ABORT_REASONS = ["digest_mismatch", "source_gone", "too_large"] as const;
// Decision 0018: why a delegated command channel ended: the host's conn_reset reasons (engine_closed also when the
// host's relayd restarted, #468), or event_gap (this device held
// more than 64 events ahead of a missing one, or a gap stayed unrepaired past the host's own loss bound: 30 s of
// re-acks with no progress, conn-channels.ts GAP_RE_ACKS_MAX).
export const CHANNEL_CLOSED_REASONS = [
  "event_overflow",
  "event_too_large",
  "idle",
  "engine_closed",
  "event_lost",
  "event_gap",
] as const;
export type ChannelClosedReason = (typeof CHANNEL_CLOSED_REASONS)[number];
export type MachineBlobAbortReason = (typeof MACHINE_BLOB_ABORT_REASONS)[number];

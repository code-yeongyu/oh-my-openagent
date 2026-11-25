import type { SurfaceExits } from "."

/** Every registered code decided as \`omo setup\` and \`omo update\` decide it today: a refusal exits 1. */
const REFUSED = {
  exit: 1,
  codes: [
    "accounts_unreachable",
    "alias_taken",
    "already_signed_in",
    "ambiguous_target",
    "approval_denied",
    "approval_expired",
    "caller_context_missing",
    "cancelled",
    "chain_count_limit",
    "credential_store_locked",
    "credential_store_unavailable",
    "cursor_invalid",
    "cursor_stale",
    "delivered_unconfirmed",
    "desktop_sign_in",
    "device_limit",
    "device_offline",
    "device_service_unavailable",
    "foreign_live_owner",
    "gateway_schema_too_new",
    "host_error",
    "host_not_answering",
    "host_unavailable",
    "idempotency_conflict",
    "idempotency_in_progress",
    "idempotency_uncertain",
    "install_failed",
    "internal_error",
    "invalid_arguments",
    "local_only",
    "loop_detected",
    "machine_exists",
    "message_too_large",
    "model_ambiguous",
    "model_not_found",
    "name_conflict",
    "no_transport",
    "not_found",
    "not_resumable",
    "not_steerable",
    "overloaded",
    "pair_loop_guard",
    "partial_commit",
    "queue_full",
    "relay_requires_paid_plan",
    "scope_denied",
    "sender_not_allowed",
    "service_refused",
    "service_unreachable",
    "session_ended",
    "signed_out",
    "thinking_level_unsupported",
    "timeout",
    "transport_expired",
    "turn_active",
    "turn_conflict",
    "unconfirmed",
    "undelivered",
    "unsupported",
  ],
} as const

/**
 * \`omo update\` (omo-native bin/lib/self-update.js and compiled-update.ts, over install-calls.js INSTALL_UPDATE_EXITS):
 * a failed package manager and a failed versioned install pass their own status through; every other failure exits 1.
 * The usage refusal (exit 2) is the parser's, before any call.
 */
export const INSTALL_UPDATE: SurfaceExits = {
  ok: 0,
  refused: REFUSED,
  rules: [
    { code: "install_failed", details: { reason: "manager_failed" }, exitFrom: "exit_status" },
    { code: "install_failed", details: { reason: "versioned" }, exitFrom: "exit_status" },
  ],
}

/** \`omo setup\` (omo-native bin/lib/setup-import.js): a failure ends through the shared fatal report, exit 1. */
export const INSTALL_SETUP: SurfaceExits = { ok: 0, refused: REFUSED, rules: [] }

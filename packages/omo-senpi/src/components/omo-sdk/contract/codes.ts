import type { Namespace } from "./namespaces"

// The code registry of design 4.4: every failure code a P1a row returns in its refusal scenarios, the namespaces that
// may return it, and the form of its next_action (the SDK operation to call next, never a CLI verb). A code of the three
// source lists that no P1a row returns is in HELD_CODES with the reason; the check fails on a code in neither.
/** `retires_with`: the slice after which no root call returns the code any more; its scenario flips there. */
type CodeEntry = {
  readonly namespaces: readonly Namespace[]
  readonly next_action: string
  readonly retires_with?: string
}

export const OMO_CODE_REGISTRY = {
  accounts_unreachable: {
    namespaces: ["account"],
    next_action:
      "The sign-in page did not answer; check the network or the accounts origin, then call account.signIn again.",
  },
  already_signed_in: {
    namespaces: ["account"],
    next_action: "This device is signed in; call account.whoami, or account.signOut before signing in again.",
  },
  device_limit: {
    namespaces: ["account"],
    next_action:
      "The account is at its device limit; revoke one listed in details (devices.revoke), then sign in again.",
  },
  machine_exists: {
    namespaces: ["account"],
    next_action: "This machine already has a device on the account; sign in with replace to take it over.",
  },
  alias_taken: {
    namespaces: ["threads"],
    next_action: "Choose another alias, or clear it from its holder (details.holder) first.",
  },
  ambiguous_target: {
    namespaces: ["devices", "sync", "threads"],
    next_action: "Pick one candidate from details.candidates and call it again with its exact address.",
  },
  approval_denied: {
    namespaces: ["sync"],
    next_action: "The person declined; nothing changed.",
  },
  approval_expired: {
    namespaces: ["sync"],
    next_action: "Start again; the approval window passed.",
  },
  caller_context_missing: {
    namespaces: ["threads"],
    next_action: "Name the thread: self is an address only a session can use.",
  },
  cancelled: {
    namespaces: ["threads"],
    next_action: "Call it again if it is still wanted.",
  },
  chain_count_limit: {
    namespaces: ["threads"],
    next_action: "End the chain; it is longer than the delivery chain limit.",
  },
  credential_store_locked: {
    namespaces: ["account"],
    next_action: "Unlock the credential store, then retry.",
  },
  credential_store_unavailable: {
    namespaces: ["account"],
    next_action: "Call account.store.status to see where credentials live, then retry.",
  },
  cursor_invalid: {
    namespaces: ["threads"],
    next_action: "Read again without a cursor, or with the next_cursor a read answered.",
  },
  cursor_stale: {
    namespaces: ["threads"],
    next_action: "Read again without a cursor; the transcript moved past it.",
  },
  delivered_unconfirmed: {
    namespaces: ["threads"],
    next_action: "It may have run or may still run; call threads.read or threads.receipt before sending again.",
  },
  desktop_sign_in: {
    namespaces: ["account", "devices"],
    next_action: "This machine is signed in through the desktop app; act there.",
  },
  device_offline: {
    namespaces: ["threads"],
    next_action: "Call devices.list; retry once the device is online.",
  },
  device_service_unavailable: {
    namespaces: ["deviceService"],
    next_action: "Call deviceService.status, then retry.",
  },
  foreign_live_owner: {
    namespaces: ["daemon", "diagnostics"],
    next_action: "Call threads.locate; the thread is live under another owner, so act through that owner.",
  },
  gateway_schema_too_new: {
    namespaces: ["threads"],
    next_action: "Update omo (install.update), restart this session, then retry.",
  },
  host_error: {
    namespaces: ["threads"],
    next_action: "It may have run; read the session's current state before resending.",
  },
  host_not_answering: {
    namespaces: ["threads"],
    next_action: "Call devices.list to see whether the device is online, then retry.",
  },
  host_unavailable: {
    namespaces: ["daemon", "deviceService", "devices", "threads"],
    next_action: "Call deviceService.status or daemon.status to see why, then retry.",
  },
  idempotency_conflict: {
    namespaces: ["daemon", "threads"],
    next_action: "Retry with a new idempotency_key, or repeat the original arguments.",
  },
  idempotency_in_progress: {
    namespaces: ["threads"],
    next_action: "Wait, then repeat the call with the same idempotency_key for its stored result.",
  },
  idempotency_uncertain: {
    namespaces: ["threads"],
    next_action: "Read the target's current state before repeating; it may have run.",
  },
  internal_error: {
    namespaces: ["account", "devices", "threads"],
    next_action: "Retry; if it fails again, report it with the details.",
  },
  invalid_arguments: {
    namespaces: [
      "account",
      "boulder",
      "config",
      "daemon",
      "deviceService",
      "devices",
      "diagnostics",
      "engine",
      "install",
      "sync",
      "threads",
      "worktrees",
    ],
    next_action: "Fix the named input and call it again.",
  },
  local_only: {
    namespaces: ["threads"],
    next_action: "Call it on the device that holds the thread.",
    retires_with: "T1d",
  },
  loop_detected: {
    namespaces: ["threads"],
    next_action: "Stop the exchange; the same delivery is circling between threads.",
  },
  message_too_large: {
    namespaces: ["threads"],
    next_action: "Send less in one call.",
  },
  model_ambiguous: {
    namespaces: ["threads"],
    next_action: "Pick one model from details.candidates, or pass provider.",
  },
  model_not_found: {
    namespaces: ["threads"],
    next_action: "Pick a model from details.available and call it again.",
  },
  name_conflict: {
    namespaces: ["threads"],
    next_action: "Choose another name, or address the thread that holds it.",
  },
  no_transport: {
    namespaces: ["threads"],
    next_action: "Call deviceService.status to see why this device has no relay transport, then retry.",
  },
  not_found: {
    namespaces: ["boulder", "daemon", "devices", "diagnostics", "engine", "sync", "threads", "worktrees"],
    next_action: "Call threads.list or devices.list for the current ids, then call it again.",
  },
  not_resumable: {
    namespaces: ["threads"],
    next_action: "Call threads.get for the thread's state; open it again with threads.create before controlling it.",
  },
  not_steerable: {
    namespaces: ["threads"],
    next_action: "Send with delivery auto or follow_up instead of steer.",
  },
  overloaded: {
    namespaces: ["threads"],
    next_action: "Retry after a short wait.",
  },
  pair_loop_guard: {
    namespaces: ["threads"],
    next_action: "This is a send loop; send to this target again after details.retry_after_ms.",
  },
  partial_commit: {
    namespaces: ["threads"],
    next_action: "Read details.partial for what was done, then call it again for the rest.",
  },
  queue_full: {
    namespaces: ["threads"],
    next_action: "Wait for the target to read its queue (threads.wait), then send again.",
  },
  relay_requires_paid_plan: {
    namespaces: ["threads"],
    next_action: "The account's plan has no relay; upgrade it, then call deviceService.status.",
  },
  scope_denied: {
    namespaces: ["daemon", "diagnostics", "engine", "threads"],
    next_action: "Call it again with all_scope, or with an input this caller may pass.",
  },
  sender_not_allowed: {
    namespaces: [
      "account",
      "boulder",
      "config",
      "daemon",
      "deviceService",
      "devices",
      "diagnostics",
      "engine",
      "install",
      "mcp",
      "sync",
      "threads",
      "toolkit",
      "worktrees",
    ],
    next_action: "This caller may not send there; send as the principal that may.",
  },
  service_refused: {
    namespaces: ["account", "sync"],
    next_action: "Read details for the account service's reason.",
  },
  service_unreachable: {
    namespaces: ["account", "devices", "install"],
    next_action: "Check the network, then retry.",
  },
  session_ended: {
    namespaces: ["account", "devices"],
    next_action: "The session ended; open it again with threads.create.",
  },
  signed_out: {
    namespaces: ["account", "deviceService", "devices", "sync"],
    next_action: "Sign in (omo login), then retry.",
  },
  thinking_level_unsupported: {
    namespaces: ["threads"],
    next_action: "Pick a level from details.supported.",
  },
  timeout: {
    namespaces: ["daemon"],
    next_action: "Retry the call; if it changes something, read the current state first.",
  },
  transport_expired: {
    namespaces: ["threads"],
    next_action: "It may have run; read the session's current state before resending.",
  },
  turn_active: {
    namespaces: ["threads"],
    next_action: "Wait for the turn with threads.wait, or pass the input that interrupts it, then retry.",
  },
  turn_conflict: {
    namespaces: ["threads"],
    next_action: "Call threads.get for the active turn, then retry with that expected_turn_id.",
  },
  unconfirmed: {
    namespaces: ["threads"],
    next_action: "It may have run; read the session's current state before resending.",
  },
  undelivered: {
    namespaces: ["threads"],
    next_action: "Nothing ran; resend with a new idempotency_key.",
  },
  unsupported: {
    namespaces: ["account", "daemon", "deviceService", "engine", "install", "threads"],
    next_action: "Update omo and the device service, or use the alternative details.reason names.",
  },
} as const satisfies Readonly<Record<string, CodeEntry>>

export type OmoCode = keyof typeof OMO_CODE_REGISTRY

export type HeldCode =
  | { readonly because: "held-rows"; readonly rows: readonly string[] }
  | { readonly because: "no-producer"; readonly note: string }
  | { readonly because: "inside-ok-answer"; readonly row: string; readonly note: string }
  | { readonly because: "principal-only"; readonly note: string }

// A source code no P1a call returns as its failure, with the checked reason: only rows P1a holds return it, no core
// produces it today (a grep of thread/, remote/ and omo-sdk/ finds no producer), it is part of an ok answer, or only a
// principal P1a-s wires can meet it.
export const HELD_CODES: Readonly<Record<string, HeldCode>> = {
  approval_route_locked: {
    because: "no-producer",
    note: "no producer in the source today (declared in THREAD_ERROR_CODES only); answering a dialog is attach's, held for P1a-s",
  },
  approval_unavailable: {
    because: "no-producer",
    note: "no producer in the source today (declared in THREAD_ERROR_CODES only); answering a dialog is attach's, held for P1a-s",
  },
  orphaned: { because: "no-producer", note: "no producer in the source today (declared in THREAD_ERROR_CODES only)" },
  no_active_turn: {
    because: "no-producer",
    note: "no producer in the source today (declared in THREAD_ERROR_CODES only); an idle interrupt answers ok with interrupted false",
  },
  transport_closed: {
    because: "no-producer",
    note: "no producer in the source today (declared in THREAD_ERROR_CODES only); a closed socket maps to host_unavailable",
  },
  prompt_not_started: {
    because: "inside-ok-answer",
    row: "threads.create",
    note: "carried inside an ok answer: the thread is created and the first prompt's failure is its prompt.error",
  },
  reply_target_mismatch: {
    because: "principal-only",
    note: "the reply policy refuses a session answering a delivery (T1a); a script holds no reply allowance",
  },
}

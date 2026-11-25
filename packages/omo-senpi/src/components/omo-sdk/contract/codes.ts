import type { Namespace } from "./namespaces"

// The code registry of design 4.4: every failure code a P1a row returns in its refusal scenarios, the namespaces that
// may return it, and the form of its next_action (the SDK operation to call next, never a CLI verb). A code of the three
// source lists that no P1a row returns is in HELD_CODES with the reason; the check fails on a code in neither.
type CodeEntry = { readonly namespaces: readonly Namespace[]; readonly next_action: string }

export const OMO_CODE_REGISTRY = {
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
  host_unavailable: {
    namespaces: ["daemon", "deviceService", "devices", "threads"],
    next_action: "Call deviceService.status or daemon.status to see why, then retry.",
  },
  idempotency_conflict: {
    namespaces: ["daemon", "threads"],
    next_action: "Retry with a new idempotency_key, or repeat the original arguments.",
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
  not_found: {
    namespaces: ["boulder", "daemon", "devices", "diagnostics", "engine", "sync", "threads", "worktrees"],
    next_action: "Call threads.list or devices.list for the current ids, then call it again.",
  },
  not_resumable: {
    namespaces: ["threads"],
    next_action: "Call threads.get for the thread's state; open it again with threads.create before controlling it.",
  },
  pair_loop_guard: {
    namespaces: ["threads"],
    next_action: "This is a send loop; send to this target again after details.retry_after_ms.",
  },
  queue_full: {
    namespaces: ["threads"],
    next_action: "Wait for the target to read its queue (threads.wait), then send again.",
  },
  scope_denied: {
    namespaces: ["daemon", "diagnostics", "engine", "threads"],
    next_action: "Call it again with all_scope, or with an input this caller may pass.",
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
    next_action: "Make the call from a root built for a principal the call allows; this principal may not make it.",
  },
  thinking_level_unsupported: {
    namespaces: ["threads"],
    next_action: "Pick a level from details.supported.",
  },
  timeout: {
    namespaces: ["daemon"],
    next_action: "Retry the call; if it changes something, read the current state first.",
  },
  turn_active: {
    namespaces: ["threads"],
    next_action: "Wait for the turn with threads.wait, or pass the input that interrupts it, then retry.",
  },
  turn_conflict: {
    namespaces: ["threads"],
    next_action: "Call threads.get for the active turn, then retry with that expected_turn_id.",
  },
  unsupported: {
    namespaces: ["account", "daemon", "deviceService", "engine", "install", "threads"],
    next_action: "Update omo and the device service, or use the alternative details.reason names.",
  },
} as const satisfies Readonly<Record<string, CodeEntry>>

export type OmoCode = keyof typeof OMO_CODE_REGISTRY

export const HELD_CODES: Readonly<Record<string, string>> = {
  accounts_unreachable:
    "returned only by account.signIn's sign-in flow, which no scenario drives before P1b's fake sign-in process",
  already_signed_in:
    "returned only by account.signIn's sign-in flow, which no scenario drives before P1b's fake sign-in process",
  approval_route_locked: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  approval_unavailable: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  cancelled: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  chain_count_limit: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  device_limit:
    "returned only by account.signIn's sign-in flow, which no scenario drives before P1b's fake sign-in process",
  host_error: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  host_not_answering: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  idempotency_in_progress: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  idempotency_uncertain: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  internal_error: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  local_only:
    "the remote client's refusal of a message to its own device; no root call returns it (security design 4.1)",
  loop_detected: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  machine_exists:
    "returned only by account.signIn's sign-in flow, which no scenario drives before P1b's fake sign-in process",
  no_active_turn: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  no_transport: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  not_steerable: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  orphaned: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  overloaded: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  partial_commit: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  prompt_not_started: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  relay_requires_paid_plan: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  reply_target_mismatch: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  transport_closed: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  transport_expired: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  unconfirmed: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
  undelivered: "no P1a row returns it in a scenario; it enters the registry with the first row that does",
}

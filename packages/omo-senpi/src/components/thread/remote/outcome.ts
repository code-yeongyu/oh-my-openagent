import type { CommandResult } from "@oh-my-opencode/device-service-core"
import { escapeForDisplay } from "@oh-my-opencode/utils/escape-for-display"
import { threadToolFailure, type ThreadToolFailure } from "../errors"
import type { RemoteCommandOutcome } from "./ports"

/**
 * The one mapping between what the device service answers for a command on another device and what every caller
 * tells the user: the relay transport, the remote session control and host, the thread SDK, `omo remote` and the
 * attach TUI all read a reply through `outcomeOf` and explain a failed one through `outcomeFailure` (#12885).
 */
type Failure = { readonly kind: "error"; readonly error: ThreadToolFailure }
const fail = (
  code: ThreadToolFailure["code"],
  message: string,
  next: string,
  details?: Readonly<Record<string, unknown>>,
): Failure => ({ kind: "error", error: threadToolFailure(code, message, next, details) })

/**
 * senpi S32: the other device refuses a thread call past its own user's `threads.chainCountLimit`, from its running
 * engine or, for a session that is not running, from its gateway store's intake. Nothing there needs updating and a
 * retry is refused again; only that device's user can allow more hops. `extra` carries the counts the store reports.
 */
export function chainCountLimitFailure(device: string, extra: Readonly<Record<string, unknown>> = {}): Failure {
  return fail(
    "chain_count_limit",
    `Device ${device} refused this thread call: the chain has made more hops than its user's thread chain limit (threads.chainCountLimit on device ${device}).`,
    `Do not retry or extend this chain; finish with what you have. Only the user of device ${device} can allow more hops, by raising or unsetting threads.chainCountLimit there.`,
    { ...extra, device, reason: "chain_count_limit", setting: "threads.chainCountLimit" },
  )
}

export function outcomeOf(result: CommandResult): RemoteCommandOutcome {
  const { outcome } = result
  if (outcome.state === "engine_refused") {
    const detail = outcome.receipt?.["reason"]
    return typeof detail === "string" && detail !== ""
      ? { kind: "refused", reason: outcome.reason, detail }
      : { kind: "refused", reason: outcome.reason }
  }
  if (outcome.state === "uncertain") return { kind: "uncertain", reason: outcome.reason }
  if (outcome.state === "engine_stale") return { kind: "uncertain", reason: "engine_stale" }
  const response = result.response ?? {}
  // The engine ran the command and answered it failed (the engine's `{success: false, error, errorCode}` envelope): a typed
  // refusal, so no caller reads `data` from a failed reply.
  if (response["success"] === false) {
    const code = response["errorCode"]
    const error = response["error"]
    return {
      kind: "refused",
      reason:
        typeof code === "string" && code.length > 0
          ? code
          : typeof error === "string" && error.length > 0
            ? error
            : "engine_failed",
    }
  }
  return result.located === undefined ? { kind: "ok", response } : { kind: "ok", response, located: result.located.key }
}

type UncertainReason = Extract<CommandResult["outcome"], { readonly state: "uncertain" }>["reason"]

// How each reason a read-only record can end uncertain with is answered once device-service.ts has refused it (nothing
// can have changed). Typed over the device service's whole uncertain vocabulary, so a new reason fails the typecheck
// here instead of falling through to "update omo".
export const READ_UNCERTAIN: Readonly<Record<UncertainReason, "retry" | "too_large">> = {
  request_gone: "retry",
  no_receipt: "retry",
  engine_restarted: "retry",
  recipient_revoked: "retry",
  transport_expired: "retry",
  unconfirmed: "retry",
  lease_expired: "retry",
  cancelled: "retry",
  hand_restarted: "retry",
  result_expired: "retry",
  record_too_large: "too_large",
  result_undecodable: "retry",
}

// Refusals after which this call changed nothing on the other device: a command that never reached its engine (a lost
// connection, a failed attach) or a read-only record that failed either way. Retrying is safe, and nothing about that
// device needs updating.
const UNANSWERED: ReadonlySet<string> = new Set([
  "closed",
  "protocol_violation",
  "internal",
  "read_failed",
  "request_timeout",
  "handshake_timeout",
  "attach_failed",
  "reply_lost",
  // omo#14130: a read the relay accepted for the device and whose answer was lost changed nothing there either.
  "delivered_unconfirmed",
  "host_not_answering",
  "peer_not_found",
  "engine_stale",
  ...Object.entries(READ_UNCERTAIN)
    .filter(([, answer]) => answer === "retry")
    .map(([reason]) => reason),
])

// Device-service refusals that say THIS device is not attached to the relay: its sign-in lapsed (the service answers
// sign_in_required at once for any call toward another device, omo-relay-daemon's sign-in gate) or it is signed out here.
// Nothing reached the other device and no update helps; the remedy is signing in on this device.
const NOT_SIGNED_IN: ReadonlySet<string> = new Set(["sign_in_required", "signed_out"])

/** The failure for a refusal (a command's or a locate's) that names this device's own missing relay sign-in, if it is one. */
export function notSignedInFailure(reason: string, device: string): Failure | undefined {
  if (!NOT_SIGNED_IN.has(reason)) return undefined
  return fail(
    "host_unavailable",
    `This device is not attached to the relay (${reason}), so device ${device} cannot be reached; nothing was sent.`,
    "Retry when this device is signed in: sign in to omo here, then retry.",
    { device, reason },
  )
}

export function outcomeFailure(
  outcome: Exclude<RemoteCommandOutcome, { readonly kind: "ok" }>,
  device: string,
): Failure {
  // #13304: a reason another device sent is printed escaped; the comparisons below read it as received.
  const reason = escapeForDisplay(outcome.reason)
  if (outcome.kind === "uncertain" && outcome.reason === "delivered_unconfirmed")
    return fail(
      "delivered_unconfirmed",
      `The command left this device and the relay accepted it for device ${device}, but no answer came back in time (delivered_unconfirmed).`,
      "Do not resend it: it may have run, or may still run. Read the thread to see whether it did.",
      { device, reason },
    )
  if (outcome.kind === "uncertain")
    return fail(
      "idempotency_uncertain",
      `The command to device ${device} may or may not have run (${reason}).`,
      "Read the thread before deciding whether to retry.",
      { device, reason },
    )
  const notSignedIn = notSignedInFailure(outcome.reason, device)
  if (notSignedIn !== undefined) return notSignedIn
  if (outcome.reason === "capability_missing")
    return fail(
      "scope_denied",
      `Device ${device} does not grant this command.`,
      "Allow commands from this device on the other device, then retry.",
      { device, reason },
    )
  if (outcome.reason === "host_detached")
    return fail(
      "host_unavailable",
      `Device ${device} is not attached to the relay.`,
      "Retry when that device is signed in and online.",
      { device, reason },
    )
  if (outcome.reason === "no_primary_endpoint")
    return fail(
      "host_unavailable",
      `Device ${device} does not list its own engine, so nothing was opened (no_primary_endpoint).`,
      "Start or restart omo on that device; if that does not help, update the device service on both devices. Then retry.",
      { device, reason: outcome.reason, remedy: "restart_omo_or_update_device_service" },
    )
  if (UNANSWERED.has(outcome.reason))
    return fail(
      "host_unavailable",
      `Device ${device} did not answer (${reason}); this call changed nothing there.`,
      "Retry; nothing needs to be checked first.",
      { device, reason },
    )
  // The session ended on that device after it was listed (its terminal closed, its host exited), or its host no longer
  // lists it (`route_unlisted`, relay-spec 0018 section 5: it parked; nothing was dispatched, omo#14233): nothing there
  // runs it, and no update changes that. Same code a control tool answers for a thread with no live owner.
  if (
    outcome.reason === "unknown_session" ||
    outcome.reason === "session_not_found" ||
    outcome.reason === "route_unlisted"
  )
    return fail(
      "not_resumable",
      `The thread is not running on device ${device} (${outcome.reason}).`,
      "Call thread_list (tool.thread_list() in an eval cell) to see the thread's current state, then retry when it runs again.",
      { device, reason: outcome.reason },
    )
  if (outcome.reason === "chain_count_limit") return chainCountLimitFailure(device)
  if (outcome.reason === "record_too_large")
    return fail(
      "unsupported",
      `The thread on device ${device} is too large to send back in one relay record (record_too_large).`,
      "Read it on that device, or ask that thread for a summary with thread_send (tool.thread_send() in an eval cell).",
      { device, reason },
    )
  return fail(
    "unsupported",
    `Device ${device} refused the command (${reason}).`,
    "Update omo on that device, or address a thread on this device.",
    { device, reason },
  )
}

/**
 * A refused record sent to another device's engine endpoint (`endpointCommand`: an open, a `find_session`). There a
 * `route_unlisted` that survived the fresh endpoint lookup names the endpoint, not a session: the engine the device named
 * went away before the record reached it (its host restarted). Nothing ran, and no omo update helps (omo#14233).
 */
export function endpointOutcomeFailure(
  outcome: Exclude<RemoteCommandOutcome, { readonly kind: "ok" }>,
  device: string,
): Failure {
  if (outcome.kind === "refused" && outcome.reason === "route_unlisted")
    return fail(
      "host_unavailable",
      `Device ${device} no longer lists the engine it named (route_unlisted); nothing was sent there.`,
      "Retry; if it repeats, restart omo on that device.",
      { device, reason: "route_unlisted" },
    )
  return outcomeFailure(outcome, device)
}

import type { CommandResult } from "@oh-my-opencode/device-service-core"
import { threadToolFailure, type ThreadToolFailure } from "../errors"
import type { RemoteCommandOutcome } from "./ports"

/**
 * The one mapping between what the device service answers for a command on another device and what every caller
 * tells the user: the relay transport, the remote session control and host, the thread SDK, `omo remote` and the
 * attach TUI all read a reply through `outcomeOf` and explain a failed one through `outcomeFailure` (#12885).
 */
type Failure = { readonly kind: "error"; readonly error: ThreadToolFailure }
const fail = (code: ThreadToolFailure["code"], message: string, next: string, details?: Readonly<Record<string, unknown>>): Failure => ({ kind: "error", error: threadToolFailure(code, message, next, details) })

export function outcomeOf(result: CommandResult): RemoteCommandOutcome {
  const { outcome } = result
  if (outcome.state === "engine_refused") return { kind: "refused", reason: outcome.reason }
  if (outcome.state === "uncertain") return { kind: "uncertain", reason: outcome.reason }
  if (outcome.state === "engine_stale") return { kind: "uncertain", reason: "engine_stale" }
  const response = result.response ?? {}
  // The engine ran the command and answered it failed (the engine's `{success: false, error, errorCode}` envelope): a typed
  // refusal, so no caller reads `data` from a failed reply.
  if (response["success"] === false) {
    const code = response["errorCode"]
    const error = response["error"]
    return { kind: "refused", reason: typeof code === "string" && code.length > 0 ? code : typeof error === "string" && error.length > 0 ? error : "engine_failed" }
  }
  return result.located === undefined ? { kind: "ok", response } : { kind: "ok", response, located: result.located.key }
}

type UncertainReason = Extract<CommandResult["outcome"], { readonly state: "uncertain" }>["reason"]

// How each reason a read-only record can end uncertain with is answered once device-service.ts has refused it (nothing
// can have changed). Typed over the device service's whole uncertain vocabulary, so a new reason fails the typecheck
// here instead of falling through to "update omo".
export const READ_UNCERTAIN: Readonly<Record<UncertainReason, "retry" | "too_large">> = {
  request_gone: "retry", no_receipt: "retry", engine_restarted: "retry", recipient_revoked: "retry", transport_expired: "retry",
  unconfirmed: "retry", lease_expired: "retry", cancelled: "retry", hand_restarted: "retry", result_expired: "retry", record_too_large: "too_large",
}

// Refusals after which this call changed nothing on the other device: a command that never reached its engine (a lost
// connection, a failed attach) or a read-only record that failed either way. Retrying is safe, and nothing about that
// device needs updating.
const UNANSWERED: ReadonlySet<string> = new Set([
  "closed", "protocol_violation", "internal", "read_failed", "request_timeout", "handshake_timeout", "attach_failed", "reply_lost",
  "host_not_answering", "peer_not_found", "engine_stale",
  ...Object.entries(READ_UNCERTAIN).filter(([, answer]) => answer === "retry").map(([reason]) => reason),
])

export function outcomeFailure(outcome: Exclude<RemoteCommandOutcome, { readonly kind: "ok" }>, device: string): Failure {
  if (outcome.kind === "uncertain") return fail("idempotency_uncertain", `The command to device ${device} may or may not have run (${outcome.reason}).`, "Read the thread before deciding whether to retry.", { device, reason: outcome.reason })
  if (outcome.reason === "capability_missing") return fail("scope_denied", `Device ${device} does not grant this command.`, "Allow commands from this device on the other device, then retry.", { device, reason: outcome.reason })
  if (outcome.reason === "host_detached") return fail("host_unavailable", `Device ${device} is not attached to the relay.`, "Retry when that device is signed in and online.", { device, reason: outcome.reason })
  if (UNANSWERED.has(outcome.reason)) return fail("host_unavailable", `Device ${device} did not answer (${outcome.reason}); this call changed nothing there.`, "Retry; nothing needs to be checked first.", { device, reason: outcome.reason })
  if (outcome.reason === "record_too_large") return fail("unsupported", `The thread on device ${device} is too large to send back in one relay record (record_too_large).`, "Read it on that device, or ask that thread for a summary with thread_send.", { device, reason: outcome.reason })
  return fail("unsupported", `Device ${device} refused the command (${outcome.reason}).`, "Update omo on that device, or address a thread on this device.", { device, reason: outcome.reason })
}

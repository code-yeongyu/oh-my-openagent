import { isRecord, type HostReply } from "./host-request"

// The reading of a host's answer to senpi's `warm` (senpi#2314), apart from the task-host warm-up so a caller that only
// asks a host to warm (the omo-senpi thread SDK, for `omo daemon run`) does not pull in the session client.

// What an engine that KNOWS `warm` refuses it with. Any other refusal (`missing_session_id` from a
// router that reads an unknown session-less command as a session command) is an engine from before it.
const WARM_REFUSALS = [
  "host_draining",
  "warm_failed",
  "invalid_session_kind",
  "invalid_session_context",
  "invalid_path",
] as const

export type WarmAnswer =
  | { readonly kind: "warm"; readonly state: "warmed" | "already_warm" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "refused"; readonly code: string }

/** A `warm` reply as the caller acts on it; also `omo daemon run`'s warm of the operator daemon (omo-senpi thread SDK). */
export function classifyWarmReply(reply: HostReply | undefined): WarmAnswer {
  if (reply === undefined) return { kind: "refused", code: "no_answer" }
  if (reply.success === true) {
    const state = isRecord(reply.data) ? reply.data.state : undefined
    return state === "warmed" || state === "already_warm" ? { kind: "warm", state } : { kind: "unsupported" }
  }
  const error = typeof reply.error === "string" ? reply.error : ""
  const known = WARM_REFUSALS.some((code) => error === code || error.startsWith(`${code}:`))
  return known ? { kind: "refused", code: error } : { kind: "unsupported" }
}

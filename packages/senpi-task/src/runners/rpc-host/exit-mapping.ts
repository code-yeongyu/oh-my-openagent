import type { ChildExitFacts, ChildExitOutcome } from "../types"
import type { HostParkCause } from "./session-client"
import { TRANSPORT_LOST_REASON } from "./transport-recovery"

/**
 * How a daemon SESSION ends, mapped onto the same `ChildExitOutcome` vocabulary a child PROCESS
 * ends with (sibling of `runners/rpc/exit-mapping.ts`). A session has no pid, no exit code and no
 * signal - the only fact it carries is the reason the host named, which rides `stderrTail` so the
 * lifecycle's error text stays identical for both runners.
 */

/** `session_closed` reasons that SUSPEND a session instead of ending it. */
const PARKING_REASONS: readonly HostParkCause[] = ["handoff_parked", "idle_evicted"]

/** The cause a `session_parked` frame stands for: the host announces only its idle sweep of a retained session that way. */
export const SESSION_PARKED_CAUSE: HostParkCause = "idle_evicted"

/** The reason a lost connection carries: a session has no stderr of its own. */
const TRANSPORT_GONE_REASON = TRANSPORT_LOST_REASON

/** Placeholder reason for a `session_closed` frame that named none. */
const UNNAMED_REASON = "session_closed"

export type SessionExitCause =
  | { readonly kind: "session_closed"; readonly reason: string | undefined }
  | { readonly kind: "session_parked" }
  | { readonly kind: "transport_gone" }
  | { readonly kind: "open_failed"; readonly message: string }

/** What THIS client last asked the host for - the difference between a clean end and a kill. */
export type SessionCloseIntent = "running" | "closed" | "terminated"

/**
 * A parked session is NOT an exit: the child keeps its record and its status, the manager parks it
 * as `rpc_detached` with the host's cause, and a later turn reopens the session from its JSONL.
 */
export type SessionExitClassification =
  | { readonly disposition: "parked"; readonly cause: HostParkCause }
  | { readonly disposition: "exit"; readonly outcome: ChildExitOutcome }

export type SessionExitInput = {
  readonly cause: SessionExitCause
  readonly intent: SessionCloseIntent
}

/** Exit facts for a session: never a pid (the daemon's pid is not this child's), never a signal. */
export function sessionExitFacts(stderrTail: string): ChildExitFacts {
  return { pid: undefined, code: null, signal: null, stderrTail }
}

export function classifySessionExit(input: SessionExitInput): SessionExitClassification {
  const { cause, intent } = input
  switch (cause.kind) {
    case "session_parked":
      return { disposition: "parked", cause: SESSION_PARKED_CAUSE }
    case "session_closed":
      // Parking wins over this client's intent: a session the daemon suspended is reopenable, so
      // calling it an exit would end a child the manager is supposed to park and wake.
      return isParkingReason(cause.reason)
        ? { disposition: "parked", cause: cause.reason }
        : ended(intent, cause.reason ?? UNNAMED_REASON)
    case "transport_gone":
      return ended(intent, TRANSPORT_GONE_REASON)
    case "open_failed":
      return {
        disposition: "exit",
        outcome: { kind: "spawn_error", message: cause.message, facts: sessionExitFacts(cause.message) },
      }
    default:
      return unreachable(cause)
  }
}

export function unreachableSessionExitClassification(value: never): never {
  throw new Error(`unhandled session exit classification: ${JSON.stringify(value)}`)
}

function isParkingReason(reason: string | undefined): reason is HostParkCause {
  return PARKING_REASONS.some((parking) => parking === reason)
}

function ended(intent: SessionCloseIntent, reason: string): SessionExitClassification {
  const facts = sessionExitFacts(reason)
  switch (intent) {
    case "closed":
      return { disposition: "exit", outcome: { kind: "clean", facts } }
    case "terminated":
      return { disposition: "exit", outcome: { kind: "killed", facts } }
    case "running":
      return { disposition: "exit", outcome: { kind: "crashed", facts } }
    default:
      return unreachable(intent)
  }
}

function unreachable(value: never): never {
  throw new Error(`unhandled session exit input: ${JSON.stringify(value)}`)
}

import { escapeForDisplay } from "@oh-my-opencode/utils/escape-for-display"
import type { ThreadToolResult } from "../contracts"
import { threadToolFailure } from "../errors"
import { outcomeFailure } from "./outcome"
import {
  rowThreadId,
  type JsonObject,
  type RemoteCommandOutcome,
  type RemoteSessionRow,
  type RemoteThreadSurface,
} from "./ports"
import { replyData } from "./remote-ops"

// What an engine that predates `find_session` (senpi#6429) answers it with; relayd refuses a record type the engine's
// advertised method table lacks as `method_unclassified`.
const NO_FIND_SESSION: ReadonlySet<string> = new Set([
  "method_unclassified",
  "unknown_command",
  "unknown_type",
  "unsupported",
  "find_session_unsupported",
])

const lacksFindSession = (outcome: RemoteCommandOutcome): boolean =>
  outcome.kind === "refused" && (NO_FIND_SESSION.has(outcome.reason) || outcome.reason.startsWith("Unknown command"))

/**
 * omo#14271: `find_session` on `device`'s primary engine, else on each other engine it lists. The primary can be older
 * than the lookup (an older desktop runtime that took over the device's default host) while an engine beside it serves
 * it; every engine of one agent dir reads the same session files, and the lookup only reads, so asking another is safe.
 * The primary is the first endpoint the device lists, so it is asked once and skipped in the fallback. An engine that
 * does not answer (a timeout, `route_unlisted`, an error) is passed over for the next, and only a real answer (found,
 * none, or ambiguous) ends the search. The primary's own refusal stands when no engine serves it, or when the device
 * cannot list its engines.
 */
type FindSessionAnswer = {
  readonly outcome: RemoteCommandOutcome
  /** Whether the device's engine list was read, so an engine beside the primary could be asked. */
  readonly listed: boolean
}

/** An engine that ran the lookup and answered it (found, none, or ambiguous); anything else is a non-answer to pass over. */
const answered = (outcome: RemoteCommandOutcome): boolean => outcome.kind === "ok"

async function findSession(remote: RemoteThreadSurface, device: string, thread: string): Promise<FindSessionAnswer> {
  const rpc = { type: "find_session", durableSessionId: thread }
  const primary = await remote.sessions.endpointCommand(device, rpc)
  if (!lacksFindSession(primary) || remote.sessions.endpointKeys === undefined)
    return { outcome: primary, listed: false }
  let keys: readonly string[]
  try {
    keys = await remote.sessions.endpointKeys(device)
  } catch {
    // Listing its engines failed: the device answers only through its primary, whose refusal is the answer.
    return { outcome: primary, listed: false }
  }
  // The primary is the first endpoint the device lists (protocol: `primary` is `endpoints[0]`); it was asked above.
  for (const endpoint of keys.slice(1)) {
    const outcome = await remote.sessions.endpointCommand(device, rpc, { endpoint })
    if (answered(outcome)) return { outcome, listed: true }
  }
  return { outcome: primary, listed: true }
}

const refusal = (
  code: Parameters<typeof threadToolFailure>[0],
  message: string,
  next: string,
  details: Readonly<Record<string, unknown>>,
): { readonly result: ThreadToolResult } => ({
  result: { kind: "error", error: threadToolFailure(code, message, next, details) },
})

const recordOf = (value: unknown): JsonObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : undefined

/** What the device holding a not-live row says of its session (`find_session`), or `unknown` when it cannot say. */
export type HolderView = "running" | "on_disk" | "absent" | "unknown"

/**
 * The holder's own answer for a row this surface reads as not live, asked before any send path is chosen (#14184): the
 * listing and this surface's closed mark lag a reopen made elsewhere (#14179 review L4), and a wake of a session the
 * holder holds no file for waits out its deadline. An engine without the lookup, or one that does not answer, is
 * `unknown`, which the send treats as on disk: an ended row is woken when this device can, anything else is
 * `not_resumable`.
 */
export async function holderView(remote: RemoteThreadSurface, row: RemoteSessionRow): Promise<HolderView> {
  const thread = rowThreadId(row)
  if (thread === "") return "unknown"
  const { outcome } = await findSession(remote, row.device, thread)
  if (outcome.kind !== "ok") return "unknown"
  const data = replyData(outcome.response)
  const found = recordOf(data["found"])
  if (found !== undefined) return found["open"] === true ? "running" : "on_disk"
  return data["unknown"] === true ? "absent" : "unknown"
}

/**
 * The session file an open of `row`'s closed session takes on its own device (#14170). A listing row never names it: its
 * `path` is the session's working folder (or `"unknown"`), which the far engine opens as a directory (EISDIR). The file is
 * the one this surface's own close was told (`session_file`), else the one its holder names for the durable id
 * (`find_session`, senpi#6429); a holder that cannot say is a typed refusal naming why.
 */
export async function sessionFileOf(
  remote: RemoteThreadSurface,
  row: RemoteSessionRow,
): Promise<{ readonly path: string } | { readonly result: ThreadToolResult }> {
  if (row.session_file !== undefined && row.session_file !== "") return { path: row.session_file }
  const thread = rowThreadId(row)
  const details = { device: row.device, thread }
  if (thread === "")
    return refusal(
      "not_found",
      `Device ${row.device} lists this thread with neither a session file nor a thread id, so it cannot be opened again.`,
      "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) and open the thread by the id it lists.",
      details,
    )
  const { outcome, listed } = await findSession(remote, row.device, thread)
  if (lacksFindSession(outcome) && outcome.kind === "refused")
    return refusal(
      "unsupported",
      listed
        ? `No engine on device ${row.device} that it lists can find the session file of closed thread ${thread} by its id (find_session): its primary engine is older than that lookup (for example an older desktop app runtime running its default host), so the thread cannot be opened from here.`
        : `Device ${row.device} could not list its engines to try another, so only its primary engine could be asked, and that engine does not serve the find_session lookup; the session file of closed thread ${thread} cannot be found from here.`,
      "On that device, restart its default engine host with the current omo (omo daemon status there shows which engine runs it) or update omo there; or open the thread on that device.",
      { ...details, reason: escapeForDisplay(outcome.reason) },
    )
  if (outcome.kind !== "ok") return { result: outcomeFailure(outcome, row.device) }
  const data = replyData(outcome.response)
  const path = recordOf(data["found"])?.["sessionPath"]
  if (typeof path === "string" && path !== "") return { path }
  if (data["ambiguous"] === true)
    return refusal(
      "ambiguous_target",
      `Device ${row.device} holds more than one session file for thread ${thread}; none was opened.`,
      "Open the thread on that device, where its files can be told apart.",
      details,
    )
  return refusal(
    "not_found",
    `Device ${row.device} holds no session file for thread ${thread}.`,
    "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) to find where the thread lives now.",
    details,
  )
}

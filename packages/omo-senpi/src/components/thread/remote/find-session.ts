import { isAbsolute } from "node:path"

import { escapeForDisplay } from "@oh-my-opencode/utils/escape-for-display"
import type { ThreadToolResult } from "../contracts"
import { threadToolFailure } from "../errors"
import { endpointOutcomeFailure } from "./outcome"
import { type JsonObject, type RemoteCommandOutcome, type RemoteSessionRow, type RemoteThreadSurface } from "./ports"
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

const recordOf = (value: unknown): JsonObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : undefined

/**
 * An engine that found the session (or found it ambiguous). A `none` from an engine of another agent dir is not the
 * device's answer: that engine reads different session files, so it truthfully holds no file for a thread the device's
 * own agent dir has (omo#14271 review M2). Only a found/ambiguous answer ends the search.
 */
const isFound = (outcome: RemoteCommandOutcome): boolean => {
  if (outcome.kind !== "ok") return false
  const data = replyData(outcome.response)
  return recordOf(data["found"]) !== undefined || data["ambiguous"] === true
}

/** The whole fallback (every listed engine) shares this budget, so a non-live send never waits minutes (omo#14271 review L1). */
const FALLBACK_TOTAL_MS = 15_000

/**
 * An engine that did not answer the lookup: a timeout, or a refusal that is not "this engine lacks find_session" (a
 * `route_unlisted`, an error). A `lacksFindSession` refusal is an answer (the engine predates the lookup), not this.
 */
const isNonAnswer = (outcome: RemoteCommandOutcome): boolean =>
  outcome.kind === "uncertain" || (outcome.kind === "refused" && !lacksFindSession(outcome))

/**
 * omo#14271: `find_session` on `device`'s primary engine, else on each other engine it lists. The primary can be older
 * than the lookup (an older desktop runtime that took over the device's default host) while an engine beside it serves
 * it; every engine of one agent dir reads the same session files, and the lookup only reads, so asking another is safe.
 * The primary is skipped by the key the device names as its own, never by position (a host may list it last). An engine
 * that does not answer (a timeout, `route_unlisted`, an error) is passed over for the next, and so is a `none` from an
 * engine of another agent dir; only a found/ambiguous answer ends the search. The primary's own refusal stands when no
 * engine serves it, or when the device cannot list its engines.
 */
type FindSessionAnswer = {
  readonly outcome: RemoteCommandOutcome
  /** Whether the device's engine list was read, so an engine beside the primary could be asked. */
  readonly listed: boolean
  /** Whether a listed engine gave a non-answer (a timeout, an error) rather than a refusal: a retry could succeed. */
  readonly uncertain: boolean
}

async function findSession(remote: RemoteThreadSurface, device: string, thread: string): Promise<FindSessionAnswer> {
  const rpc = { type: "find_session", durableSessionId: thread }
  const primary = await remote.sessions.endpointCommand(device, rpc)
  if (!lacksFindSession(primary) || remote.sessions.endpointKeys === undefined)
    return { outcome: primary, listed: false, uncertain: false }
  let listed: { readonly keys: readonly string[]; readonly primary?: string }
  try {
    listed = await remote.sessions.endpointKeys(device)
  } catch {
    // Listing its engines failed: the device answers only through its primary, whose refusal is the answer.
    return { outcome: primary, listed: false, uncertain: false }
  }
  const deadline = Date.now() + FALLBACK_TOTAL_MS
  let uncertain = false
  for (const endpoint of listed.keys) {
    // The primary was already asked; skip it by the key the device names, never by position.
    if (endpoint === listed.primary) continue
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    const outcome = await remote.sessions.endpointCommand(device, rpc, { endpoint, waitMs: remaining })
    if (isFound(outcome)) return { outcome, listed: true, uncertain: false }
    if (isNonAnswer(outcome)) uncertain = true
  }
  return { outcome: primary, listed: true, uncertain }
}

const refusal = (
  code: Parameters<typeof threadToolFailure>[0],
  message: string,
  next: string,
  details: Readonly<Record<string, unknown>>,
): { readonly result: ThreadToolResult } => ({
  result: { kind: "error", error: threadToolFailure(code, message, next, details) },
})

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
  // find_session looks a session up by its durable id; a row without one cannot be looked up.
  const thread = row.durable_id ?? ""
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
): Promise<{ readonly path: string; readonly cwd?: string } | { readonly result: ThreadToolResult }> {
  if (row.session_file !== undefined && row.session_file !== "") return { path: row.session_file }
  const thread = row.durable_id ?? ""
  const details = { device: row.device, thread }
  if (thread === "")
    return refusal(
      "not_found",
      `Device ${row.device} lists this thread with neither a session file nor a thread id, so it cannot be opened again.`,
      "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) and open the thread by the id it lists.",
      details,
    )
  const { outcome, listed, uncertain } = await findSession(remote, row.device, thread)
  if (lacksFindSession(outcome) && outcome.kind === "refused")
    return refusal(
      "unsupported",
      uncertain
        ? `Device ${row.device} could not be asked completely: an engine it lists did not answer the find_session lookup (a timeout or an error), so the session file of closed thread ${thread} could not be found. Retry.`
        : listed
          ? `No engine on device ${row.device} that it lists can find the session file of closed thread ${thread} by its id (find_session): its primary engine is older than that lookup (for example an older desktop app runtime running its default host), so the thread cannot be opened from here.`
          : `Device ${row.device} could not list its engines to try another, so only its primary engine could be asked, and that engine does not serve the find_session lookup; the session file of closed thread ${thread} cannot be found from here.`,
      uncertain
        ? "Retry; if it repeats, open the thread on that device."
        : "On that device, restart its default engine host with the current omo (omo daemon status there shows which engine runs it) or update omo there; or open the thread on that device.",
      { ...details, reason: escapeForDisplay(outcome.reason) },
    )
  if (outcome.kind !== "ok") return { result: endpointOutcomeFailure(outcome, row.device) }
  const data = replyData(outcome.response)
  const found = recordOf(data["found"])
  const path = found?.["sessionPath"]
  // The folder the file records: a reopen names it, so b's engine opens it without probing the path (#14296).
  const cwd = found?.["cwd"]
  if (typeof path === "string" && path !== "")
    return typeof cwd === "string" && isAbsolute(cwd) ? { path, cwd } : { path }
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

import type { ThreadToolResult } from "../contracts"
import { threadToolFailure } from "../errors"
import { outcomeFailure } from "./outcome"
import { rowThreadId, type JsonObject, type RemoteSessionRow, type RemoteThreadSurface } from "./ports"
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

/**
 * Whether an engine on `row`'s device runs its session now, by the holder's own answer (`find_session`'s `open`), for a
 * row this surface reads as ended: the listing and this surface's closed mark lag a reopen made elsewhere (#14179 review
 * L4). A holder that cannot say counts as not running it.
 */
export async function runsNow(remote: RemoteThreadSurface, row: RemoteSessionRow): Promise<boolean> {
  const thread = rowThreadId(row)
  if (thread === "") return false
  const outcome = await remote.sessions.endpointCommand(row.device, { type: "find_session", durableSessionId: thread })
  return outcome.kind === "ok" && recordOf(replyData(outcome.response)["found"])?.["open"] === true
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
      "Call thread_list with all_scope and open the thread by the id it lists.",
      details,
    )
  const outcome = await remote.sessions.endpointCommand(row.device, { type: "find_session", durableSessionId: thread })
  if (
    outcome.kind === "refused" &&
    (NO_FIND_SESSION.has(outcome.reason) || outcome.reason.startsWith("Unknown command"))
  )
    return refusal(
      "unsupported",
      `Device ${row.device} cannot find the session file of closed thread ${thread} by its id (find_session), so it cannot be opened from here.`,
      "Update omo on that device, or open the thread there.",
      { ...details, reason: outcome.reason },
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
    "Call thread_list with all_scope to find where the thread lives now.",
    details,
  )
}

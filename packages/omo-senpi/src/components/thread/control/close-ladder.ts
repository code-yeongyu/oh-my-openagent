import type { JsonObject } from "../remote/ports"
import type { ThreadCloseAnswer, ThreadCloseOutcome } from "../tools/ports"
import { refuse } from "./port"

/**
 * How a leg answers one engine record for the ladder: the engine's reply data, or `gone` when the engine no longer
 * holds the session (`SESSION_GONE`). Every other failure the leg throws itself, typed the way that leg types it.
 */
export type RecordAnswer =
  { readonly kind: "ok"; readonly data: JsonObject } | { readonly kind: "gone"; readonly reason: string }

/**
 * The refusals that mean the session was not on its host when the record arrived: the engine's, and the device service's
 * `route_unlisted` (relay-spec 0018 section 5: the host lists no such session right now, so nothing was dispatched;
 * it parked after it was listed, omo#14233).
 */
export const SESSION_GONE: ReadonlySet<string> = new Set([
  "unknown_session",
  "route_unlisted",
  "session_identity_mismatch",
  "session_not_attached",
  "not_attached",
])

/** senpi#7006 (senpi#7004): the engine takes `unload_session { deliveries: "refuse" }` and names the unwritten deliveries it refuses on. */
const UNLOAD_REFUSE_DELIVERIES = "unload_refuse_deliveries"

const UNLOAD = { type: "unload_session", force: true, children: "detach" } as const

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []

const deliveriesOf = (value: unknown): string[] | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? strings((value as JsonObject)["deliveries"])
    : undefined

/**
 * The one close ladder (#12879 audit 2), on this device's host and on another device alike. `unload_session` with force
 * ends the session for every client that holds it (senpi session-unload.ts). A close never drops a message the session
 * has not read unless the caller asked for it (omo#14234, LEAD ruling):
 *
 * - `force`: one interrupting unload; whatever the engine hands back unwritten is listed in `dropped_deliveries`.
 * - default: a non-interrupting unload first, which drops nothing on any engine and closes an idle session in one round
 *   trip. A refusal that names unwritten deliveries (`pending.deliveries`) comes from an engine with
 *   `unload_refuse_deliveries`; any other busy refusal asks the engine for that capability (`get_protocol_info`). A
 *   capable engine gets `interrupt` with `deliveries: "refuse"`: it stops a run with nothing unread, hands back an idle
 *   session's stranded deliveries (senpi#6971, listed), and refuses a busy one with unread deliveries, naming them. An
 *   engine without the capability ignores `deliveries`, so it is never sent an interrupt: the close is refused, saying
 *   the ids are unavailable there and that `force: true` closes it.
 *
 * A session with no file yet cannot be unloaded (`unsupported`), so it gets an attached `close_session`, which releases
 * only this hold, and one `get_state` probe: still answered, another client holds it; gone, it ended. A draining host is
 * `host_unavailable`; any other unload refusal is typed `unsupported` naming the engine's reason.
 */
export async function closeLadder(
  sessionId: string,
  send: (rpc: JsonObject) => Promise<RecordAnswer>,
  options: { readonly force?: boolean } = {},
): Promise<ThreadCloseAnswer> {
  const done = (outcome: ThreadCloseOutcome, data?: JsonObject): ThreadCloseAnswer => ({
    outcome,
    dropped_deliveries: deliveriesOf(data?.["dropped"]) ?? [],
  })
  type Unloaded = { readonly done: ThreadCloseAnswer } | { readonly refused: JsonObject }
  const unload = async (record: JsonObject): Promise<Unloaded> => {
    const answered = await send({ ...UNLOAD, sessionId, ...record })
    if (answered.kind === "gone") return { done: done("not_live") }
    if (answered.data["outcome"] === "unloaded") return { done: done("closed", answered.data) }
    if (answered.data["reason"] === "session_closing") return { done: done("not_live", answered.data) }
    return { refused: answered.data }
  }
  const first = await unload(options.force === true ? { interrupt: true } : { deliveries: "refuse" })
  if ("done" in first) return first.done
  let refused = first.refused
  if (options.force !== true && (refused["reason"] === "turn_active" || refused["reason"] === "work_pending")) {
    const pending = deliveriesOf(refused["pending"])
    if (pending === undefined && !(await refusesDeliveries(sessionId, send)))
      throw refuse(
        "turn_active",
        refused["reason"] === "turn_active"
          ? `Thread ${sessionId} is still working (${describe(refused)}), and its host's engine cannot name the messages a forced close would drop.`
          : `Thread ${sessionId} holds messages it has not read (${describe(refused)}), and its host's engine cannot name them.`,
        "Wait for it to read them, or close it with force: true (anything it has not read is dropped); an engine that names them comes with a newer senpi on that device.",
        {
          command: "unload_session",
          reason: refused["reason"],
          detail: refused["detail"],
          pending_deliveries: "unavailable",
        },
      )
    const second = await unload({ interrupt: true, deliveries: "refuse" })
    if ("done" in second) return second.done
    refused = second.refused
    const unread = deliveriesOf(refused["pending"])
    // Any refusal that names unread deliveries is answered by them, whichever blocker the engine named first.
    if (unread !== undefined && unread.length > 0)
      throw refuse(
        "turn_active",
        `Thread ${sessionId} has ${unread.length} message(s) it has not read yet (${unread.join(", ")}); closing it now would drop them.`,
        "Let it read them and retry, or close it with force: true to drop them (the result lists dropped_deliveries).",
        {
          command: "unload_session",
          reason: refused["reason"],
          pending_deliveries: unread,
          retry_with: { force: true },
        },
      )
  }
  return await refusedUnload(sessionId, refused, send)
}

const describe = (data: JsonObject): string =>
  typeof data["detail"] === "string" ? `${String(data["reason"])}: ${data["detail"]}` : String(data["reason"])

/** Whether the session's engine advertises `unload_refuse_deliveries`; anything it cannot answer counts as an older engine. */
async function refusesDeliveries(
  sessionId: string,
  send: (rpc: JsonObject) => Promise<RecordAnswer>,
): Promise<boolean> {
  try {
    const info = await send({ type: "get_protocol_info", sessionId, observe: true })
    return info.kind === "ok" && strings(info.data["capabilities"]).includes(UNLOAD_REFUSE_DELIVERIES)
  } catch {
    return false
  }
}

async function refusedUnload(
  sessionId: string,
  refused: JsonObject,
  send: (rpc: JsonObject) => Promise<RecordAnswer>,
): Promise<ThreadCloseAnswer> {
  const reason = refused["reason"]
  if (reason === "host_draining")
    throw refuse(
      "host_unavailable",
      `The host holding thread ${sessionId} is shutting down and refused to close it.`,
      "Retry once that host has restarted.",
      { command: "unload_session", reason },
    )
  if (reason !== "unsupported") {
    // The engine's detail names which blocker held the session (#14169): without it a caller cannot tell a turn, a
    // bash command or an unwritten delivery apart.
    const detail = typeof refused["detail"] === "string" ? `: ${refused["detail"]}` : ""
    // Deliveries an interrupt handed back before a later blocker refused the unload are gone from the session either way.
    const dropped = deliveriesOf(refused["dropped"])
    throw refuse(
      "unsupported",
      `The host holding thread ${sessionId} refused to close it (${String(reason)}${detail}).`,
      "Read the thread and retry once its work settles.",
      {
        command: "unload_session",
        reason,
        detail: refused["detail"],
        ...(dropped === undefined || dropped.length === 0 ? {} : { dropped_deliveries: dropped }),
      },
    )
  }
  const close = await send({ type: "close_session", sessionId })
  if (close.kind === "gone") return { outcome: "not_live", dropped_deliveries: [] }
  const probe = await send({ type: "get_state", sessionId })
  return { outcome: probe.kind === "gone" ? "closed" : "held_elsewhere", dropped_deliveries: [] }
}

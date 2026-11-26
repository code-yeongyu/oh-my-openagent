import { randomUUID } from "node:crypto"

import type { JsonObject } from "../remote/ports"
import { waitWithinCallBudget } from "../../call-budget/call-deadline"
import type {
  ThreadCloseAnswer,
  ThreadCloseGraceful,
  ThreadCloseOptions,
  ThreadCloseOutcome,
  ThreadUnloadAnswer,
  ThreadUnloadOptions,
} from "../tools/ports"
import type { ThreadToolFailure } from "../errors"
import { refusal } from "../refusal-texts"
import { refuseWith } from "./port"

/**
 * How a leg answers one engine record for the ladder: the engine's reply data, or `gone` when the engine no longer
 * holds the session (`SESSION_GONE`). Every other failure the leg throws itself, typed the way that leg types it.
 */
export type RecordAnswer =
  { readonly kind: "ok"; readonly data: JsonObject } | { readonly kind: "gone"; readonly reason: string }

/**
 * One engine record of the ladder. `waitMs`: how long the engine may take to answer it (a graceful close's drain); a leg
 * whose own request bound is shorter (a terminal's control socket) waits that long instead.
 */
export type LadderSend = (rpc: JsonObject, options?: { readonly waitMs?: number }) => Promise<RecordAnswer>

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

/** senpi `unload_session` (senpi#3225): the record every close ends with, and the SDK's unload on its own. */
const UNLOAD_SESSION = "unload_session"

/** senpi#7006 (senpi#7004): the engine takes `unload_session { deliveries: "refuse" }` and names the unwritten deliveries it refuses on. */
const UNLOAD_REFUSE_DELIVERIES = "unload_refuse_deliveries"

/** senpi `unload_session { graceful, waitMs }` (omo#14313). */
const UNLOAD_GRACEFUL = "unload_graceful"

/** A graceful close's wait when the caller names none, and what of the tool call's budget it leaves for the answer. */
const GRACEFUL_WAIT_MS = 30_000
const GRACEFUL_ANSWER_RESERVE_MS = 10_000

const UNLOAD = { type: UNLOAD_SESSION, force: true, children: "detach" } as const

const closeEffectId = (): string => `omo-thread-close:${randomUUID()}`
const unloadEffectId = (): string => `omo-thread-unload:${randomUUID()}`

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []

const deliveriesOf = (value: unknown): string[] | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? strings((value as JsonObject)["deliveries"])
    : undefined

/** The queued user messages an unload took out of the session (senpi `dropped.user_messages`). */
const userMessagesOf = (value: unknown): string[] =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? strings((value as JsonObject)["user_messages"])
    : []

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
 *
 * Every unload carries its own `effectId` (#14273): senpi then writes the unload to the session's transcript on its
 * holder, so the holder's wake sweep knows the session was closed on request, and when, whichever device closed it
 * (`wake/session-target.ts` `closed_at`). An engine without the effect ledger ignores the field.
 *
 * `graceful` (omo#14313) is one record of its own, `gracefulClose`. `legMaxWaitMs`: the longest drain the leg can wait
 * for its answer (`REMOTE_GRACEFUL_MAX_WAIT_MS` on the relay leg); a longer `wait_ms` is cut to it and an expired drain
 * says so (`wait_capped`).
 */
export async function closeLadder(
  sessionId: string,
  send: LadderSend,
  options: ThreadCloseOptions = {},
  legMaxWaitMs?: number,
): Promise<ThreadCloseAnswer> {
  if (options.graceful === true) return await gracefulClose(sessionId, send, options.wait_ms, legMaxWaitMs)
  const done = (outcome: ThreadCloseOutcome, data?: JsonObject): ThreadCloseAnswer => ({
    outcome,
    dropped_deliveries: deliveriesOf(data?.["dropped"]) ?? [],
  })
  type Unloaded = { readonly done: ThreadCloseAnswer } | { readonly refused: JsonObject }
  const unload = async (record: JsonObject): Promise<Unloaded> => {
    const answered = await send({ ...UNLOAD, sessionId, effectId: closeEffectId(), ...record })
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
    if (pending === undefined && !(await advertises(sessionId, send, UNLOAD_REFUSE_DELIVERIES)))
      throw refuseWith(
        refusal(
          refused["reason"] === "turn_active" ? "control.close_working_unnamed" : "control.close_unread_unnamed",
          { thread: sessionId, state: describe(refused) },
          {
            command: "unload_session",
            reason: refused["reason"],
            detail: refused["detail"],
            pending_deliveries: "unavailable",
          },
        ),
      )
    const second = await unload({ interrupt: true, deliveries: "refuse" })
    if ("done" in second) return second.done
    refused = second.refused
    const unread = deliveriesOf(refused["pending"])
    // Any refusal that names unread deliveries is answered by them, whichever blocker the engine named first.
    if (unread !== undefined && unread.length > 0)
      throw refuseWith(
        refusal(
          "control.close_unread",
          { thread: sessionId, count: String(unread.length), deliveries: unread.join(", ") },
          {
            command: "unload_session",
            reason: refused["reason"],
            pending_deliveries: unread,
            retry_with: { force: true },
          },
        ),
      )
  }
  return await refusedUnload(sessionId, refused, send)
}

const describe = (data: JsonObject): string =>
  typeof data["detail"] === "string" ? `${String(data["reason"])}: ${data["detail"]}` : String(data["reason"])

/**
 * omo#14313: one `unload_session { graceful, waitMs }`. The engine refuses new messages at once (their senders read
 * `session_closing`), hands the unread ones back (`dropped_deliveries`; each sender's row settles `target_closed` on the
 * holder), lets the running turn end, stops monitors, loops and the goal cleanly and ends the session. The wait is cut to
 * what the tool call's budget leaves (`waitWithinCallBudget`), so an expired drain is answered typed inside the call:
 * `turn_active` with `still_running`, the session still open and taking messages again. An engine without
 * `unload_graceful` is refused before anything is sent: a graceful close never falls back to an interrupting one.
 */
async function gracefulClose(
  sessionId: string,
  send: LadderSend,
  waitMs: number | undefined,
  legMaxWaitMs: number | undefined,
): Promise<ThreadCloseAnswer> {
  if (!(await advertises(sessionId, send, UNLOAD_GRACEFUL)))
    throw refuseWith(
      refusal(
        "control.close_not_graceful",
        { thread: sessionId },
        { command: "unload_session", capability: UNLOAD_GRACEFUL },
      ),
    )
  const requested = waitMs ?? GRACEFUL_WAIT_MS
  const legCut = legMaxWaitMs !== undefined && requested > legMaxWaitMs ? legMaxWaitMs : undefined
  const wait = waitWithinCallBudget(legCut ?? requested, GRACEFUL_ANSWER_RESERVE_MS)
  // Only a drain the leg's cap bounded names the cap: when the call budget cut it shorter, the cap did not limit it.
  const capped = legCut !== undefined && wait === legCut ? legCut : undefined
  if (wait <= 0)
    throw refuseWith(refusal("control.close_no_time", { thread: sessionId }, { command: "unload_session" }))
  const answered = await send(
    { ...UNLOAD, sessionId, effectId: closeEffectId(), graceful: true, waitMs: wait },
    { waitMs: wait },
  )
  if (answered.kind === "gone") return { outcome: "not_live", dropped_deliveries: [] }
  const { data } = answered
  const dropped = deliveriesOf(data["dropped"]) ?? []
  if (data["outcome"] === "unloaded")
    return { outcome: "closed", dropped_deliveries: dropped, graceful: gracefulOf(data) }
  if (data["reason"] === "session_closing") return { outcome: "not_live", dropped_deliveries: dropped }
  if (data["timed_out"] === true)
    throw refuseWith(
      refusal(
        capped === undefined ? "control.close_still_working" : "control.close_still_working_capped",
        {
          thread: sessionId,
          turn: String(data["turn"]),
          waited_ms: String(data["waited_ms"]),
          returned: String(dropped.length),
          ...(capped === undefined ? {} : { requested_ms: String(requested) }),
        },
        {
          ...(capped === undefined ? {} : { wait_capped: { requested_ms: requested, max_ms: capped } }),
          command: "unload_session",
          reason: "turn_active",
          still_running: true,
          open: true,
          turn: data["turn"],
          waited_ms: data["waited_ms"],
          returned_deliveries: dropped,
          retry_with: { force: true },
        },
      ),
    )
  if (data["reason"] === "composer_draft")
    throw refuseWith(
      refusal(
        "control.close_composer_draft",
        { thread: sessionId },
        { command: "unload_session", reason: "composer_draft" },
      ),
    )
  return await refusedUnload(sessionId, data, send)
}

function gracefulOf(data: JsonObject): ThreadCloseGraceful {
  const graceful = data["graceful"]
  const facts = typeof graceful === "object" && graceful !== null && !Array.isArray(graceful) ? graceful : {}
  const stopped = "stopped" in facts ? facts.stopped : undefined
  return {
    turn: "turn" in facts && typeof facts.turn === "number" ? facts.turn : 0,
    waited_ms: "waited_ms" in facts && typeof facts.waited_ms === "number" ? facts.waited_ms : 0,
    stopped_wake_sources:
      typeof stopped === "object" && stopped !== null && "wake_sources" in stopped ? strings(stopped.wake_sources) : [],
    returned_user_messages: userMessagesOf(data["dropped"]),
  }
}

/**
 * The SDK's `threads.unload` (omo#14943 T1b): ONE `unload_session` carrying the caller's own choices, on this device's
 * host and on another device alike, never the close ladder's escalation. The session leaves its host and stays
 * resumable from its file; its queued input stays for the reopen unless `clear_queue`. An engine that does not advertise
 * `unload_session` is refused before anything is sent. The answer names what the unload dropped: the deliveries the
 * engine handed back unwritten and the user messages it took out of the queue. An engine that no longer holds the
 * session is `not_found`; every engine refusal is typed by the blocker it names, with the option that gets past it.
 */
export async function unloadOver(
  sessionId: string,
  thread: string,
  send: LadderSend,
  options: ThreadUnloadOptions = {},
): Promise<ThreadUnloadAnswer> {
  const notHeld = (reason: string) =>
    refuseWith(refusal("control.unload_not_held", { thread, reason }, { command: UNLOAD_SESSION, reason }))
  // Another device's holder answers the probe for a session it no longer holds as it would the unload.
  const info = await protocolInfo(sessionId, send)
  if (info?.kind === "gone") throw notHeld(info.reason)
  if (info === undefined || !strings(info.data["capabilities"]).includes(UNLOAD_SESSION))
    throw refuseWith(
      refusal("control.unload_unsupported", { thread }, { command: UNLOAD_SESSION, capability: UNLOAD_SESSION }),
    )
  const answered = await send({
    type: UNLOAD_SESSION,
    sessionId,
    effectId: unloadEffectId(),
    ...(options.interrupt === true ? { interrupt: true } : {}),
    ...(options.force === true ? { force: true } : {}),
    ...(options.clear_queue === true ? { clearQueue: true } : {}),
    ...(options.children === undefined ? {} : { children: options.children }),
  })
  if (answered.kind === "gone") throw notHeld(answered.reason)
  const { data } = answered
  const dropped_deliveries = deliveriesOf(data["dropped"]) ?? []
  const dropped_user_messages = userMessagesOf(data["dropped"])
  if (data["outcome"] === "unloaded") return { outcome: "unloaded", dropped_deliveries, dropped_user_messages }
  if (data["reason"] === "session_closing") return { outcome: "not_live", dropped_deliveries, dropped_user_messages }
  throw refuseWith(unloadRefusal(thread, data, dropped_deliveries))
}

function unloadRefusal(thread: string, data: JsonObject, dropped: readonly string[]): ThreadToolFailure {
  const reason = data["reason"]
  const detail = data["detail"]
  const pending = deliveriesOf(data["pending"])
  const details = {
    command: UNLOAD_SESSION,
    reason,
    ...(typeof detail === "string" ? { detail } : {}),
    ...(pending === undefined || pending.length === 0 ? {} : { pending_deliveries: pending }),
    // Deliveries an interrupt handed back before a later blocker refused the unload are gone from the session either way.
    ...(dropped.length === 0 ? {} : { dropped_deliveries: dropped }),
  }
  const slots = { thread, state: describe(data) }
  switch (reason) {
    case "turn_active":
    case "work_pending":
      return refusal("control.unload_working", slots, { ...details, retry_with: { interrupt: true } })
    case "children_live":
      return refusal("control.unload_children", slots, { ...details, retry_with: { children: "detach" } })
    case "extension_work":
      return refusal("control.unload_extension_work", slots, { ...details, retry_with: { force: true } })
    case "attached":
      return refusal("control.unload_attached", slots, { ...details, retry_with: { force: true } })
    case "host_draining":
      return refusal("control.unload_host_draining", { thread }, details)
    default:
      return refusal("control.unload_refused", slots, details)
  }
}

/** Whether the session's engine advertises `capability`; anything it cannot answer counts as an older engine. */
async function advertises(sessionId: string, send: LadderSend, capability: string): Promise<boolean> {
  const info = await protocolInfo(sessionId, send)
  return info?.kind === "ok" && strings(info.data["capabilities"]).includes(capability)
}

/** The engine's `get_protocol_info` (an observing read); undefined when it cannot answer it (an older engine). */
async function protocolInfo(sessionId: string, send: LadderSend): Promise<RecordAnswer | undefined> {
  try {
    return await send({ type: "get_protocol_info", sessionId, observe: true })
  } catch {
    return undefined
  }
}

async function refusedUnload(sessionId: string, refused: JsonObject, send: LadderSend): Promise<ThreadCloseAnswer> {
  const reason = refused["reason"]
  if (reason === "host_draining")
    throw refuseWith(
      refusal("control.close_host_draining", { thread: sessionId }, { command: "unload_session", reason }),
    )
  if (reason !== "unsupported") {
    // The engine's detail names which blocker held the session (#14169): without it a caller cannot tell a turn, a
    // bash command or an unwritten delivery apart.
    const detail = refused["detail"]
    // Deliveries an interrupt handed back before a later blocker refused the unload are gone from the session either way.
    const dropped = deliveriesOf(refused["dropped"])
    throw refuseWith(
      refusal(
        typeof detail === "string" ? "control.close_refused_detail" : "control.close_refused",
        { thread: sessionId, reason: String(reason), ...(typeof detail === "string" ? { detail } : {}) },
        {
          command: "unload_session",
          reason,
          detail,
          ...(dropped === undefined || dropped.length === 0 ? {} : { dropped_deliveries: dropped }),
        },
      ),
    )
  }
  const close = await send({ type: "close_session", sessionId })
  if (close.kind === "gone") return { outcome: "not_live", dropped_deliveries: [] }
  const probe = await send({ type: "get_state", sessionId })
  return { outcome: probe.kind === "gone" ? "closed" : "held_elsewhere", dropped_deliveries: [] }
}

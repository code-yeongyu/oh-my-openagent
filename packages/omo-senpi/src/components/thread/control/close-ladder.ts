import { randomUUID } from "node:crypto"

import type { JsonObject } from "../remote/ports"
import { waitWithinCallBudget } from "../../call-budget/call-deadline"
import type { ThreadCloseAnswer, ThreadCloseGraceful, ThreadCloseOptions, ThreadCloseOutcome } from "../tools/ports"
import { refuse } from "./port"

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

/** senpi#7006 (senpi#7004): the engine takes `unload_session { deliveries: "refuse" }` and names the unwritten deliveries it refuses on. */
const UNLOAD_REFUSE_DELIVERIES = "unload_refuse_deliveries"

/** senpi `unload_session { graceful, waitMs }` (omo#14313). */
const UNLOAD_GRACEFUL = "unload_graceful"

/** A graceful close's wait when the caller names none, and what of the tool call's budget it leaves for the answer. */
const GRACEFUL_WAIT_MS = 30_000
const GRACEFUL_ANSWER_RESERVE_MS = 10_000

const UNLOAD = { type: "unload_session", force: true, children: "detach" } as const

const closeEffectId = (): string => `omo-thread-close:${randomUUID()}`

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
 *
 * Every unload carries its own `effectId` (#14273): senpi then writes the unload to the session's transcript on its
 * holder, so the holder's wake sweep knows the session was closed on request, and when, whichever device closed it
 * (`wake/session-target.ts` `closed_at`). An engine without the effect ledger ignores the field.
 *
 * `graceful` (omo#14313) is one record of its own, `gracefulClose`.
 */
export async function closeLadder(
  sessionId: string,
  send: LadderSend,
  options: ThreadCloseOptions = {},
): Promise<ThreadCloseAnswer> {
  if (options.graceful === true) return await gracefulClose(sessionId, send, options.wait_ms)
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

/**
 * omo#14313: one `unload_session { graceful, waitMs }`. The engine refuses new messages at once (their senders read
 * `session_closing`), hands the unread ones back (`dropped_deliveries`; each sender's row settles `target_closed` on the
 * holder), lets the running turn end, stops monitors, loops and the goal cleanly and ends the session. The wait is cut to
 * what the tool call's budget leaves (`waitWithinCallBudget`), so an expired drain is answered typed inside the call:
 * `turn_active` with `still_running`, the session still open and taking messages again. An engine without
 * `unload_graceful` is refused before anything is sent: a graceful close never falls back to an interrupting one.
 */
async function gracefulClose(sessionId: string, send: LadderSend, waitMs?: number): Promise<ThreadCloseAnswer> {
  if (!(await advertises(sessionId, send, UNLOAD_GRACEFUL)))
    throw refuse(
      "unsupported",
      `The engine holding thread ${sessionId} cannot close it gracefully: it runs a senpi from before graceful close.`,
      "Update omo on that device and restart its host, or close the thread with force: true (its running turn is stopped).",
      { command: "unload_session", capability: UNLOAD_GRACEFUL },
    )
  const wait = waitWithinCallBudget(waitMs ?? GRACEFUL_WAIT_MS, GRACEFUL_ANSWER_RESERVE_MS)
  if (wait <= 0)
    throw refuse(
      "unsupported",
      `This call has no time left to wait for thread ${sessionId}'s turn.`,
      "Close it again in a new call.",
      { command: "unload_session" },
    )
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
    throw refuse(
      "turn_active",
      `Thread ${sessionId} is still working on turn ${String(data["turn"])} after ${String(data["waited_ms"])} ms. It stays open and takes messages again; the ${dropped.length} unread message(s) taken out of its queue are queued for it again.`,
      "Close it again with a longer wait_ms once its turn is nearly done, or with force: true to stop the turn.",
      {
        command: "unload_session",
        reason: "turn_active",
        still_running: true,
        open: true,
        turn: data["turn"],
        waited_ms: data["waited_ms"],
        returned_deliveries: dropped,
        retry_with: { force: true },
      },
    )
  if (data["reason"] === "composer_draft")
    throw refuse(
      "unsupported",
      `Thread ${sessionId}'s terminal has unsent text in its composer, and a close would discard it.`,
      "Ask the person at that terminal to send or clear it, then close the thread again.",
      { command: "unload_session", reason: "composer_draft" },
    )
  return await refusedUnload(sessionId, data, send)
}

function gracefulOf(data: JsonObject): ThreadCloseGraceful {
  const graceful = data["graceful"]
  const facts = typeof graceful === "object" && graceful !== null && !Array.isArray(graceful) ? graceful : {}
  const dropped = data["dropped"]
  const stopped = "stopped" in facts ? facts.stopped : undefined
  return {
    turn: "turn" in facts && typeof facts.turn === "number" ? facts.turn : 0,
    waited_ms: "waited_ms" in facts && typeof facts.waited_ms === "number" ? facts.waited_ms : 0,
    stopped_wake_sources:
      typeof stopped === "object" && stopped !== null && "wake_sources" in stopped ? strings(stopped.wake_sources) : [],
    returned_user_messages:
      typeof dropped === "object" && dropped !== null && "user_messages" in dropped
        ? strings(dropped.user_messages)
        : [],
  }
}

/** Whether the session's engine advertises `capability`; anything it cannot answer counts as an older engine. */
async function advertises(sessionId: string, send: LadderSend, capability: string): Promise<boolean> {
  try {
    const info = await send({ type: "get_protocol_info", sessionId, observe: true })
    return info.kind === "ok" && strings(info.data["capabilities"]).includes(capability)
  } catch {
    return false
  }
}

async function refusedUnload(sessionId: string, refused: JsonObject, send: LadderSend): Promise<ThreadCloseAnswer> {
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

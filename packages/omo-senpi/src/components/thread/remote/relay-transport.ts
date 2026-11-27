import { randomUUID } from "node:crypto"
import { rowKey } from "@oh-my-opencode/thread-address-core"
import { escapeForDisplay } from "@oh-my-opencode/utils/escape-for-display"
import { rowStatus } from "./ports"
import { pairLoopGuardMessage, pairLoopGuardNextAction, threadToolFailure, type ThreadToolFailure } from "../errors"
import { hashArgs } from "../gateway/hash-args"
import { decideDelivery, effectiveLaneOf } from "../gateway/decision"
import { senderFacts } from "../gateway/envelope"
import { renderDeliveryDisplayText, renderDeliveryText } from "../gateway/provenance"
import { REFUSAL_CODES } from "../gateway/result"
import type { GatewayStore } from "../gateway/store"
import type { DeliveryOutcome, DeliveryTransport, OutboundDelivery, RelayDeliverySuccess } from "../gateway/transport"
import type { DeliveryWait, EffectiveLane, GatewayDeliveryDelivery, Provenance } from "../gateway/types"
import { UNKNOWN_CALLER } from "../tools/ports"
import type { JsonObject, RemoteCommandOutcome, RemoteSessionRow, RemoteThreadSurface } from "./ports"
import { replyData } from "./remote-ops"
import { resolveTypedDevice } from "../address/device"
import { chainCountLimitFailure, engineNotReady, outcomeFailure } from "./outcome"
import { holderView } from "./find-session"
import { reopenParkedRow } from "./reopen-parked"
import { outsideCallDeadline } from "../../call-budget/call-deadline"
import { reconcileRemoteReceipt } from "./receipt"

export type RelayTransportOptions = {
  readonly remote: RemoteThreadSurface
  readonly store: Pick<
    GatewayStore,
    | "now"
    | "toolReceiptBegin"
    | "toolReceiptSettle"
    | "toolReceiptRevise"
    | "toolReceiptRelease"
    | "deliveryView"
    | "reconcileRemoteReceipt"
  >
  readonly now?: () => number
  readonly senderProvenance: () => Promise<Provenance>
  readonly callerCause?: () => string | undefined
  /** The highest chain hop an input of the caller's current run arrived with from another device (K8). */
  readonly callerChainHop?: () => number
  readonly log?: (line: string) => void
  /** The waits between background re-sends of a delivery the receiver's open draft holds; after the last one it gives up. Test seam. */
  readonly heldRetryDelaysMs?: readonly number[]
  readonly retryDelay?: (ms: number, signal: AbortSignal) => Promise<void>
}

type Failure = { readonly kind: "error"; readonly error: ThreadToolFailure }
type SendOutcome = Failure | RelayDeliverySuccess
/** Replaces the answer the send's receipt replays with what later became of the delivery. */
type Revise = (result: SendOutcome) => Promise<void>
/** Work a send leaves for after its receipt is settled, so a revision always lands on the settled receipt. */
type Later = (task: (revise: Revise) => Promise<void>) => void
const fail = (
  code: ThreadToolFailure["code"],
  message: string,
  next: string,
  details?: Readonly<Record<string, unknown>>,
): Failure => ({ kind: "error", error: threadToolFailure(code, message, next, details) })

// The refusals that mean the other side has no `admit_external_message` record (senpi#6240): the device service refuses a
// record the engine's method classes do not name before it leaves the device (`method_unclassified`), senpi's delegated
// connection refuses an unclassified type (`delegation_unclassified`), and an older engine refuses an unknown command.
const ADMIT_UNSUPPORTED: ReadonlySet<string> = new Set([
  "method_unclassified",
  "delegation_unclassified",
  "unknown_command",
  "engine_capability_missing",
  "unsupported_command",
  "method_unknown",
])

// About half an hour of background re-sends while the receiver's user keeps a draft open (the engine admits nothing then);
// the same delivery id each time, so the engine answers already_admitted once it took one.
const HELD_RETRY_DELAYS_MS: readonly number[] = [
  5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 300_000, 300_000, 300_000, 300_000, 300_000,
]

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    ;(timer as { unref?: () => void }).unref?.()
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

const ADMIT_RECORD = "admit_external_message"

// The get_state probe is read-only and runs before any record is sent: one that ends uncertain changed nothing on that
// device, so it is a transport failure that is safe to retry, never idempotency_uncertain (#12925).
function probeFailure(outcome: Exclude<RemoteCommandOutcome, { readonly kind: "ok" }>, device: string): Failure {
  if (outcome.kind !== "uncertain") return outcomeFailure(outcome, device)
  return fail(
    "host_unavailable",
    `Device ${device} did not answer the state read (${outcome.reason}); nothing was sent there.`,
    "Retry; nothing needs to be checked first.",
    { device, reason: outcome.reason },
  )
}

type EngineState = {
  /** The decision table's phase (gateway/decision.ts): a turn parked on an approval or a compaction is neither idle nor running. */
  readonly phase: "idle" | "mid_turn" | "waiting_question" | "compacting"
  readonly turnEpoch: number | null
  readonly pending: number | null
  readonly parkedOnApproval: boolean
  /** The session is paused or carries holds (senpi get_state `paused`, `holds`): a queued message waits on them (A2.6). */
  readonly held: boolean
}

function engineStateOf(reply: JsonObject): EngineState {
  // The engine parks a turn on two kinds of approval a human must answer on that device: an open question (an ask, in
  // pendingQuestions) and a permission prompt (a dialog, in pendingDialogs). Either means the turn is not running.
  const open = (value: unknown): boolean => Array.isArray(value) && value.length > 0
  const parkedOnApproval = open(reply["pendingQuestions"]) || open(reply["pendingDialogs"])
  const compacting = reply["isCompacting"] === true
  const midTurn = reply["isStreaming"] === true && !compacting && !parkedOnApproval
  const current = reply["currentTurnId"]
  const turnEpoch = typeof current === "string" && /^\d+$/.test(current) ? Number(current) : null
  const pending = reply["pendingMessageCount"]
  return {
    phase: parkedOnApproval ? "waiting_question" : compacting ? "compacting" : midTurn ? "mid_turn" : "idle",
    turnEpoch,
    pending: typeof pending === "number" && Number.isInteger(pending) && pending >= 1 ? pending : null,
    parkedOnApproval,
    held: reply["paused"] === true || open(reply["holds"]),
  }
}

const WAITS: ReadonlySet<string> = new Set(["wake", "hold", "approval"])

type SteerRefusal = "turn_conflict" | "not_steerable"

/** A steer the receiving engine refused as a command because no running turn could take it (#14320). */
const refusedSteer = (outcome: RemoteCommandOutcome): SteerRefusal | undefined =>
  outcome.kind === "refused" && (outcome.reason === "turn_conflict" || outcome.reason === "not_steerable")
    ? outcome.reason
    : undefined

/** The same race answered either way: as reply data (`data.kind`) or as a refused command (`reason`). */
const steerConflict = (outcome: RemoteCommandOutcome): SteerRefusal | undefined =>
  outcome.kind === "ok"
    ? replyData(outcome.response)["kind"] === "turn_conflict"
      ? "turn_conflict"
      : undefined
    : refusedSteer(outcome)

// A refusal reason the receiving side sent. Every reason a receiving side produces is a lowercase machine code (the
// consumer's and carrier's refusals, and the table below), so a reason is shown only when it has that shape; any other text
// from that device becomes UNRECOGNISED_REASON and is never shown, in the message or in details.reason.
const REASON_CODE = /^[a-z0-9][a-z0-9_.-]{0,63}$/
const UNRECOGNISED_REASON = "unrecognised"
const shownReason = (reason: string): string => (REASON_CODE.test(reason) ? reason : UNRECOGNISED_REASON)

/**
 * omo#13037 section 5.1: what a session that is not running answers, from the receiving consumer (`data.kind` "refused")
 * or from the receiving device service itself (the command's receipt). One mapping for both.
 */
function wakeRefusal(received: string, device: string, data: JsonObject = {}): Failure {
  const reason = shownReason(received)
  const details = { device, reason }
  switch (reason) {
    case "session_gone":
      return fail(
        "not_found",
        `Device ${device} holds no session file for that id.`,
        "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell).",
        details,
      )
    case "ambiguous_session":
      return fail(
        "ambiguous_target",
        `Device ${device} holds more than one session file with that id; none was picked.`,
        "Address another thread, or resolve the duplicate on that device.",
        details,
      )
    case "not_wakeable":
    case "sender_not_admitted":
      return fail(
        "not_resumable",
        `Device ${device} cannot wake that session (${reason}).`,
        "Address another thread.",
        details,
      )
    case "queue_full":
      return fail("queue_full", `The session on device ${device} has a full backlog.`, "Retry later.", details)
    case "overloaded": {
      const retry = data["retry_after_ms"]
      return fail("overloaded", `Device ${device} is waking too many sessions now.`, "Retry after the given delay.", {
        ...details,
        ...(typeof retry === "number" ? { retry_after_ms: retry } : {}),
      })
    }
    case "pair_loop_guard": {
      // The receiving store's pair loop guard (`store-ops.ts` `takePairToken`): the same answer a send on this device gets.
      const burst = typeof data["burst"] === "number" ? data["burst"] : undefined
      const windowMs = typeof data["window_ms"] === "number" ? data["window_ms"] : undefined
      const retry = typeof data["retry_after_ms"] === "number" ? data["retry_after_ms"] : undefined
      return fail(
        "pair_loop_guard",
        burst !== undefined && windowMs !== undefined
          ? pairLoopGuardMessage("this device", `the session on device ${device}`, burst, windowMs)
          : `Device ${device} held this send back: this device sent that session its whole burst; it was not delivered.`,
        retry !== undefined
          ? pairLoopGuardNextAction(retry)
          : "This looks like a send loop between these two sessions; wait before sending to that session again.",
        {
          ...details,
          guard: "pair_loop",
          ...(burst === undefined ? {} : { burst }),
          ...(windowMs === undefined ? {} : { window_ms: windowMs }),
          ...(retry === undefined ? {} : { retry_after_ms: retry }),
        },
      )
    }
    case "wake_limit_reached":
      return fail(
        "overloaded",
        `The session on device ${device} reached its limit of unattended wakes; the message stays queued there.`,
        "Wait for a person to use that session.",
        details,
      )
    case "wake_unavailable":
      return fail(
        "host_unavailable",
        `No omo process on device ${device} can take the message now.`,
        "Start omo once on that device, then retry.",
        details,
      )
    case "chain_count_limit": {
      // The receiving store's own chain limit (`store-worker.ts`): the same refusal the running engine answers.
      const counts = Object.fromEntries(
        ["chain_count", "limit"].flatMap((key) => (typeof data[key] === "number" ? [[key, data[key]]] : [])),
      )
      return chainCountLimitFailure(device, counts)
    }
    case "wake_unsupported":
      return fail(
        "unsupported",
        `Device ${device} cannot wake a session that is not running.`,
        "Update omo on that device.",
        details,
      )
    default:
      return fail(
        "unsupported",
        `Device ${device} refused the message (${reason === UNRECOGNISED_REASON ? "unrecognised reason" : reason}).`,
        "Address another thread.",
        details,
      )
  }
}

/**
 * Other-device transport: one `admit_external_message` on the target device's session, carrying the text the receiver of
 * a same-device delivery reads (`renderDeliveryText` over the same envelope), so the receiving engine writes a delivery
 * entry and starts a turn on it exactly as the local drain does. The device is never in the text: the receiving engine
 * stamps the connection it arrived on. A send to another device has no gateway row to carry its idempotency, so it
 * keeps the same promise through the tool receipt store: a retry under the same key replays the first answer and sends
 * nothing; a retry that crossed is `already_admitted` on the engine. The chain the caller's run consumed continues (K8).
 */
export function createRelayTransport(
  options: RelayTransportOptions,
): DeliveryTransport & { readonly dispose: () => void } {
  const { remote, store } = options
  const now = options.now ?? store.now
  const log = options.log ?? (() => undefined)
  const retryDelays = options.heldRetryDelaysMs ?? HELD_RETRY_DELAYS_MS
  const retryDelay = options.retryDelay ?? abortableDelay
  // Background re-sends of held deliveries; dispose aborts them (a receiver that already took one answers already_admitted).
  const disposed = new AbortController()
  const retryHeld = async (
    row: RemoteSessionRow,
    record: JsonObject,
    deliveryId: string,
    revise: Revise,
  ): Promise<void> => {
    for (const [attempt, wait] of retryDelays.entries()) {
      log(
        `relay_delivery_held: delivery ${deliveryId} to ${row.session_id} on device ${row.device} waits behind an open draft; re-send ${attempt + 1} of ${retryDelays.length} in ${Math.round(wait / 1000)} s.`,
      )
      await retryDelay(wait, disposed.signal)
      if (disposed.signal.aborted) return
      const sent = await remote.sessions.sessionCommand(row.device, row.session_id, record).catch((error: unknown) => ({
        kind: "uncertain" as const,
        reason: error instanceof Error ? error.message : String(error),
      }))
      const conflict = steerConflict(sent)
      if (conflict !== undefined) {
        // An explicit steer the draft held until its turn ended, answered as reply data or as a refused command (#14320).
        // The sender was answered queued; its receipt now answers the refusal, so a retry under the same idempotency key
        // reads what became of it (the local row's `refused`).
        const turnId = sent.kind === "ok" ? replyData(sent.response)["turnId"] : undefined
        await revise(
          fail(
            REFUSAL_CODES[conflict].code,
            `Turn ${String(record["expectedTurnId"] ?? "?")} of ${row.session_id} on device ${row.device} ended while that session's open draft held the steer; it was not delivered.`,
            REFUSAL_CODES[conflict].next,
            {
              device: row.device,
              delivery_id: deliveryId,
              ...(typeof turnId === "string" && turnId !== "" ? { current_turn_id: turnId } : {}),
            },
          ),
        )
        log(
          `relay_delivery_failed: delivery ${deliveryId} to ${row.session_id} on device ${row.device}: re-send ${attempt + 1} ended ${conflict} (the steered turn ended while the draft held it); the send's receipt now answers that refusal.`,
        )
        return
      }
      if (sent.kind !== "ok") {
        log(
          `relay_delivery_failed: delivery ${deliveryId} to ${row.session_id} on device ${row.device}: re-send ${attempt + 1} ended ${sent.kind} (${sent.reason}).`,
        )
        return
      }
      if (replyData(sent.response)["kind"] !== "held_draft") return
    }
    log(
      `relay_delivery_failed: delivery ${deliveryId} to ${row.session_id} on device ${row.device} was held behind that session's open draft through ${retryDelays.length} re-sends.`,
    )
  }
  const unsettled = new Map<string, string>()
  const receiptKey = (scope: {
    readonly principal: string
    readonly operation: string
    readonly idempotency_key: string
  }) => `${scope.principal}\u0000${scope.operation}\u0000${scope.idempotency_key}`

  async function once(
    callerId: string,
    idempotencyKey: string,
    args: unknown,
    run: (later: Later, sending: () => void) => Promise<SendOutcome>,
  ): Promise<SendOutcome> {
    const scope = { principal: `session:${callerId}`, operation: "thread_send:remote", idempotency_key: idempotencyKey }
    const admission = await store.toolReceiptBegin({ ...scope, now: now(), args_hash: hashArgs(args) })
    if (admission.kind === "replay") {
      const first = admission.result as SendOutcome
      return first.kind === "ok" ? await reconcileRemoteReceipt(store, remote, callerId, idempotencyKey, first) : first
    }
    if (admission.kind === "conflict")
      return fail(
        "idempotency_conflict",
        "The idempotency key was already used with different arguments.",
        "Retry with a new idempotency_key.",
      )
    const note = unsettled.get(receiptKey(scope))
    if (admission.kind === "in_progress" && note !== undefined)
      return fail(
        "idempotency_uncertain",
        "The earlier operation may have been delivered.",
        "Read the target transcript before deciding whether to retry.",
        { error_note: note },
      )
    if (admission.kind === "in_progress")
      return fail(
        "idempotency_in_progress",
        "The same operation is already in progress.",
        "Wait for the earlier call to settle, then retry.",
      )
    if (admission.kind === "uncertain")
      return fail(
        "idempotency_uncertain",
        "The earlier operation may have been delivered.",
        "Read the target transcript before deciding whether to retry.",
      )
    const unrecorded = (what: string) => (settleError: unknown) => {
      unsettled.set(
        receiptKey(scope),
        `${what}, and its receipt could not be recorded: ${settleError instanceof Error ? settleError.message : String(settleError)}`,
      )
    }
    let result: SendOutcome
    const tasks: Array<(revise: Revise) => Promise<void>> = []
    let sent = false
    // A receipt that cannot be dropped is settled as before, so a retry still answers instead of waiting on it.
    const release = async (settle: () => Promise<unknown>) => {
      if (!(await store.toolReceiptRelease(scope).catch(() => false))) await settle()
    }
    try {
      result = await run(
        (task) => {
          tasks.push(task)
        },
        () => {
          sent = true
        },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const settle = () =>
        store
          .toolReceiptSettle({ ...scope, now: now(), error_note: message })
          .catch(unrecorded(`the send failed (${message})`))
      await (sent ? settle() : release(settle))
      throw error
    }
    if (!sent) {
      await release(() => store.toolReceiptSettle({ ...scope, now: now(), result }).catch(unrecorded("the send ran")))
      return result
    }
    await store.toolReceiptSettle({ ...scope, now: now(), result }).catch(unrecorded("the send ran"))
    const revise: Revise = async (later) => {
      const revised = await store.toolReceiptRevise({ ...scope, now: now(), result: later }).catch((error: unknown) => {
        log(`relay_receipt_unrevised: ${idempotencyKey}: ${error instanceof Error ? error.message : String(error)}`)
        return true
      })
      if (!revised) log(`relay_receipt_unrevised: ${idempotencyKey}: no settled receipt of this process to revise.`)
    }
    // omo#14130 review H1: a queued task (a held re-send) runs past this call, so never under its budget.
    for (const task of tasks) void outsideCallDeadline(() => task(revise))
    return result
  }

  async function chain(): Promise<{ readonly delivery_id: string; readonly root_id: string; readonly hop: number }> {
    const cause = options.callerCause?.()
    const prior = cause === undefined ? undefined : (await store.deliveryView(cause))?.row
    return {
      delivery_id: randomUUID(),
      root_id: prior?.root_id ?? `root-${randomUUID()}`,
      hop: Math.max(prior?.hop ?? 0, options.callerChainHop?.() ?? 0) + 1,
    }
  }

  /**
   * #14184: where a send to `listed` goes. A live row is sent to as listed. For a row that is not live (ended, or a
   * cached snapshot) its holder is asked first (`find_session`), because a command to the listing key, or a wake of a
   * session the holder holds no file for, waits out the device's own deadline (about 60 s): no file is `not_found` at
   * once (as the refused reopen says); one it runs is addressed by the key its device locates it by now, never the
   * listing's (a reopen elsewhere can run it under a new key; #14179 reviews L4, M1); one on disk takes the wake path when
   * this device has one, else `not_resumable` at once, as thread_read answers it. A holder that cannot say is treated as
   * holding it on disk: an ended row takes the wake path when there is one, anything else is `not_resumable`.
   * `parked` (#14240): the row reads live but its host refused a command to it `route_unlisted` (it parked the session),
   * so the listing is stale: `parked` is the answer that refusal maps to. The holder is asked as for a not-live row, and a
   * session it holds on disk takes the wake path whatever the row's state. A holder that cannot say (find_session refused,
   * unsupported or unanswered) taught nothing new, so the answer stays `parked`.
   */
  async function addressOf(
    listed: RemoteSessionRow,
    parked?: SendOutcome,
  ): Promise<{ readonly row: RemoteSessionRow; readonly ended: boolean } | SendOutcome> {
    if (parked === undefined && rowStatus(listed) === "live") return { row: listed, ended: false }
    // The row as a caller addresses it (its thread id, else <device id>/<listing key>); locate reads the thread id itself.
    const thread = rowKey(listed)
    const details = { device: listed.device, thread }
    const view = await holderView(remote, listed)
    if (view === "absent")
      return fail(
        "not_found",
        `Device ${listed.device} holds no session file for ${thread}.`,
        "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell).",
        details,
      )
    if (parked !== undefined && view === "unknown") return parked
    if (view !== "running") {
      // omo#13037 5.4 / A4.5: a session no engine runs takes the wake path when this device's service can carry it.
      const wakeable = parked !== undefined ? view === "on_disk" : listed.state === "ended"
      if (wakeable && (await remote.sessions.canWake?.()) === true) return { row: listed, ended: true }
      // omo#14799: with no wake path, the parked session is reopened on its device and sent to there.
      const reopened = await reopenParkedRow(remote, listed, view)
      if ("row" in reopened) return { row: reopened.row, ended: false }
      if (reopened.result.kind === "error") return reopened.result
      return fail(
        "internal_error",
        `Reopening ${thread} on device ${listed.device} answered no row.`,
        "Retry the send.",
        details,
      )
    }
    const located = await remote.sessions.locate(listed.device, listed.durable_id ?? "")
    if (located.kind !== "ok")
      return fail(
        "not_resumable",
        `Device ${listed.device} runs ${thread}, but the key it runs under cannot be found there (${escapeForDisplay(located.reason)}).`,
        "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell), then send again.",
        { ...details, reason: escapeForDisplay(located.reason) },
      )
    remote.sessions.reopened?.(listed, located.sessionId)
    return { row: { ...listed, session_id: located.sessionId }, ended: false }
  }

  /**
   * `retry` (#14240): the second and last attempt, after the host refused the first `route_unlisted` for a row that read
   * live; it re-addresses the row as parked and keeps the first attempt's delivery ids, so a repeat is never a second
   * delivery. The refusal means nothing was dispatched there; `refusal` is what it answers unless the holder says more.
   */
  async function send(
    delivery: OutboundDelivery,
    listed: RemoteSessionRow,
    later: Later,
    sending: () => void,
    retry?: {
      readonly ids: Awaited<ReturnType<typeof chain>> | undefined
      readonly announced: boolean
      readonly refusal: SendOutcome
    },
  ): Promise<SendOutcome> {
    const online = await resolveTypedDevice(remote.client, listed.device, { exactId: true })
    if (online.kind === "error") return online
    const parkedHere = (outcome: RemoteCommandOutcome) =>
      retry === undefined &&
      rowStatus(listed) === "live" &&
      outcome.kind === "refused" &&
      outcome.reason === "route_unlisted"
    const addressed = await addressOf(listed, retry?.refusal)
    if (!("row" in addressed)) return addressed
    // `ended`: the wake path (no lane probe; its state is offline in the decision table, so a steer is turn_conflict).
    const { row, ended } = addressed
    if (ended && delivery.mode === "steer")
      return fail(
        REFUSAL_CODES.turn_conflict.code,
        `${rowKey(row)} on device ${row.device} is not running, so no turn of it can be steered.`,
        REFUSAL_CODES.turn_conflict.next,
        { device: row.device, thread: rowKey(row) },
      )
    const expected = delivery.expected_turn_id === undefined ? null : Number(delivery.expected_turn_id)
    // A woken session starts a turn when it opens; a live one takes the lane its probe decides.
    let lane: EffectiveLane = ended ? "start" : "follow_up"
    let steerTurn: number | null = null
    let probedState: EngineState | undefined
    // One get_state decides the lane the way the local drain does (gateway/decision.ts): a steer must name the running
    // turn, the default (auto) steers whatever turn is running, and every mode starts a turn when the target is idle.
    if (!ended) {
      const probed = await remote.sessions.sessionCommand(row.device, row.session_id, {
        type: "get_state",
        sessionId: row.session_id,
      })
      if (probed.kind !== "ok") {
        const refusal = probeFailure(probed, row.device)
        // A live-listed row its host parked is re-addressed through the holder whatever the mode (#14240).
        if (parkedHere(probed))
          return await send(delivery, listed, later, sending, { ids: undefined, announced: false, refusal })
        // Only a steer or the default needs the probe to pick its lane. An explicit follow_up is delivered whatever the
        // target is doing, so a lost or refused probe leaves its lane unknown instead of failing the send.
        if (delivery.mode !== "follow_up") return refusal
      }
      const state: EngineState | undefined =
        probed.kind === "ok" ? engineStateOf(replyData(probed.response)) : undefined
      probedState = state
    }
    if (probedState !== undefined) {
      const state = probedState
      const decision = decideDelivery(state.phase, delivery.mode, expected, state.turnEpoch)
      if (decision.kind !== "admit") {
        const reason = decision.kind === "refuse" ? decision.reason : "turn_conflict"
        const mapped = REFUSAL_CODES[reason] ?? {
          code: "internal_error" as const,
          next: "Call thread_list (tool.thread_list() in an eval cell) and check the target.",
        }
        return fail(
          mapped.code,
          `A steer to ${row.session_id} on device ${row.device} was refused: ${reason}.`,
          mapped.next,
          { device: row.device, ...(state.turnEpoch === null ? {} : { current_turn_id: String(state.turnEpoch) }) },
        )
      }
      // A paused or held session queues the message on its holds (A2.6): an idle one starts nothing until they lift.
      lane = state.held && decision.expect === "started" ? "follow_up" : effectiveLaneOf(decision)
      if (decision.deliverAs === "steer") steerTurn = decision.expected_turn_id ?? expected
    }
    const facts = senderFacts(delivery.sender, await options.senderProvenance())
    const ids = retry?.ids ?? (await chain())
    const { delivery_id, root_id, hop } = ids
    const name = delivery.sender.kind === "session" ? delivery.sender.name?.trim() : undefined
    const recordFor = (effective: EffectiveLane) =>
      remote.chain.stamp(
        {
          type: ADMIT_RECORD,
          // A woken session is addressed by its durable id: no listing maps it to a key (5.4).
          sessionId: ended ? (row.durable_id ?? row.session_id) : row.session_id,
          deliveryId: delivery_id,
          text: renderDeliveryText({
            delivery_id,
            envelope: {
              provenance: facts.provenance,
              origin: facts.origin(delivery_id),
              actor: facts.actor,
              via: [facts.node],
              root_id,
              hop,
              delivery_id,
              ...(delivery.authority === undefined ? {} : { authority: delivery.authority }),
            },
            body: delivery.text,
            mode_requested: delivery.mode,
            mode_effective: effective,
          }),
          displayText: renderDeliveryDisplayText({
            envelope: {
              provenance: facts.provenance,
              ...(delivery.authority === undefined ? {} : { authority: delivery.authority }),
            },
            body: delivery.text,
          }),
          sender: {
            kind: "agent",
            session_id: delivery.caller_id,
            ...(name === undefined || name === "" ? {} : { name }),
          },
          deliverAs: effective === "steer" ? "steer" : "followUp",
          ...(effective === "steer" && steerTurn !== null ? { expectedTurnId: String(steerTurn) } : {}),
          chainCount: hop,
        },
        hop,
      )
    let record = recordFor(lane)
    // A delivery the receiver's draft holds is re-sent later on the lane its record names; that lane is the true one.
    let resentLane: EffectiveLane | undefined
    const ok = (kind: GatewayDeliveryDelivery, deduplicated = false): RelayDeliverySuccess => ({
      kind: "ok",
      thread_id: rowKey(row),
      delivery: kind,
      deduplicated,
      device: row.device,
      delivery_id,
      effective_mode: resentLane ?? effectiveLaneOfAnswer(kind),
    })
    // One delivery is announced once: a retry after the first attempt's admission was refused does not announce it again.
    if (retry?.announced !== true) sending()
    if (ended) return wakeAnswer(await woken(row, record), row, delivery_id, ok)
    let sent = await remote.sessions.sessionCommand(row.device, row.session_id, record)
    if (delivery.mode === "auto" && lane === "steer" && steerConflict(sent) !== undefined) {
      // The turn the probe saw ended before the record arrived. The default never fails on that race: it takes the lane the
      // target has now (started when idle, queued behind a turn that began since), as a local drain re-decides at admission.
      // The receiver may answer it as reply data or as a refused command (#14320); both take this one re-send.
      lane = "follow_up"
      record = recordFor(lane)
      sent = await remote.sessions.sessionCommand(row.device, row.session_id, record)
    }
    // The retry re-stamps its own record (a wake addresses the durable id on the follow-up lane); `stamp` is a pure
    // function of (record, hop) and the ids are the first attempt's, so the receiver sees one delivery.
    if (sent.kind !== "ok" && parkedHere(sent))
      return await send(delivery, listed, later, sending, {
        ids,
        announced: true,
        refusal: outcomeFailure(sent, row.device),
      })
    if (
      sent.kind === "refused" &&
      engineNotReady(sent) === undefined &&
      (ADMIT_UNSUPPORTED.has(sent.reason) || sent.reason.startsWith("Unknown command"))
    )
      return fail(
        "unsupported",
        `Device ${row.device} runs an engine without admit_external_message (${escapeForDisplay(sent.reason)}); a peer message cannot be delivered there as a delivery.`,
        "Update omo and senpi on that device, then retry.",
        { device: row.device, reason: escapeForDisplay(sent.reason) },
      )
    const conflict = steerConflict(sent)
    if (conflict !== undefined) {
      const current = sent.kind === "ok" ? replyData(sent.response)["turnId"] : undefined
      return fail(
        REFUSAL_CODES[conflict].code,
        conflict === "turn_conflict"
          ? `Turn ${delivery.expected_turn_id ?? "?"} is no longer the running turn of ${row.session_id} on device ${row.device}.`
          : `A steer to ${row.session_id} on device ${row.device} was refused: not_steerable.`,
        REFUSAL_CODES[conflict].next,
        { device: row.device, ...(typeof current === "string" && current !== "" ? { current_turn_id: current } : {}) },
      )
    }
    if (sent.kind !== "ok") return outcomeFailure(sent, row.device)
    const reply = replyData(sent.response)
    const kind = reply["kind"]
    const turnId = typeof reply["turnId"] === "string" ? reply["turnId"] : ""
    if (kind === "started" || kind === "steered") return ok({ kind, turn_id: turnId })
    if (kind !== "queued" && kind !== "held_draft" && kind !== "held" && kind !== "already_admitted")
      return fail(
        "idempotency_uncertain",
        `Device ${row.device} accepted the message but answered an unknown admission (${String(kind)}).`,
        "Read the thread before deciding whether to send again.",
        { device: row.device, delivery_id },
      )
    // Queued, held behind the receiver's open draft, or already taken: the delivery waits on that device exactly as a
    // same-device delivery waits in its inbox (gateway/drain.ts answers held_draft as queued and re-admits it on the next
    // edge). Its place is the engine's own pending count. A held one is re-sent in the background under the same id.
    const after = await remote.sessions.sessionCommand(row.device, row.session_id, {
      type: "get_state",
      sessionId: row.session_id,
    })
    // When that read fails, the probe's state (auto and steer modes) still says whether the receiver was parked.
    const afterState = after.kind === "ok" ? engineStateOf(replyData(after.response)) : probedState
    const pending = after.kind === "ok" ? (afterState?.pending ?? null) : null
    if (kind === "held_draft") {
      // The receiver's draft gate answers before its turn check. A default-mode steer it holds would be re-sent against a
      // turn that may have ended by the time the draft goes (turn_conflict, silently lost), and a start it holds starts
      // nothing until the draft goes: the re-sends take followUp, and the sender's answer names that lane.
      if (delivery.mode !== "steer" && lane !== "follow_up") {
        lane = "follow_up"
        record = recordFor(lane)
      }
      resentLane = lane
      later((revise) => retryHeld(row, record, delivery_id, revise))
    }
    // Each of these kinds is the engine's own receipt that it holds the delivery, so none of them is uncertain. The
    // engine's pendingMessageCount does not count an admitted delivery (senpi enqueues it straight into the agent's queue,
    // outside the user-input count), so a receiver that reports none still holds it, first in line: position 1.
    // A receiver parked on an approval (an open question its human must answer on that device) waits behind that
    // approval (#12886); a paused or held one waits on its holds. `held` is the engine's own word for that: idle under a
    // hold a peer cannot release (a Stop, an interrupted run, a parent's run hold; senpi#7014), kept until it is released.
    if (kind === "held" || (kind === "queued" && afterState?.held === true))
      return ok({ kind: "queued", queue_position: pending ?? 1, waiting_on: { kind: "hold", device: row.device } })
    if (kind === "queued" && afterState?.parkedOnApproval === true)
      return ok({ kind: "queued", queue_position: pending ?? 1, waiting_on: { kind: "approval", device: row.device } })
    return ok({ kind: "queued", queue_position: pending ?? 1 }, kind === "already_admitted")
  }

  /**
   * The lane the receiver's answer proves. The probe only chooses what to ask for: a turn can begin or end before the
   * record lands, so a started answer is a start, a steered one a steer, and a queued one a follow-up. A delivery that
   * waits only for its device to wake the session starts that session's turn when it opens.
   */
  const effectiveLaneOfAnswer = (answer: GatewayDeliveryDelivery): EffectiveLane => {
    if (answer.kind === "started") return "start"
    if (answer.kind === "steered") return "steer"
    return answer.kind === "queued" && answer.waiting_on?.kind === "wake" ? "start" : "follow_up"
  }

  const woken = (row: RemoteSessionRow, record: JsonObject) =>
    remote.sessions.wake?.(row.device, row.durable_id ?? row.session_id, record) ??
    Promise.resolve({ kind: "unavailable" as const })

  /** The wake path's answers (5.1), mapped once: the consumer's envelope, the service's own refusals, a lost reply. */
  function wakeAnswer(
    sent: Awaited<ReturnType<typeof woken>>,
    row: RemoteSessionRow,
    deliveryId: string,
    ok: (kind: GatewayDeliveryDelivery, deduplicated?: boolean) => RelayDeliverySuccess,
  ): SendOutcome {
    const device = row.device
    if (sent.kind === "unavailable") return wakeRefusal("wake_unsupported", device)
    if (sent.kind === "uncertain")
      // The receiving device may still hold the delivery and run it when it wakes the session: never "read the thread".
      return fail(
        "idempotency_uncertain",
        `Delivery ${deliveryId} to device ${device} may still be delivered when that device wakes the session (${sent.reason}).`,
        "Retry with the same idempotency_key; a repeat of this delivery is never delivered twice.",
        { device, delivery_id: deliveryId, reason: sent.reason, pending_wake: true },
      )
    if (sent.kind === "refused") {
      if (sent.reason === "unsupported") return wakeRefusal("wake_unsupported", device)
      if (sent.reason === "engine_capability_missing" && sent.detail !== undefined)
        return wakeRefusal(sent.detail, device)
      // The service's refusal can carry the other device's free-form error text: the same allowlist (#13277 review).
      return outcomeFailure({ ...sent, reason: shownReason(sent.reason) }, device)
    }
    const data = replyData(sent.response)
    const kind = data["kind"]
    if (kind === "queued") {
      const wait = (data["waiting_on"] as JsonObject | undefined)?.["kind"]
      return ok(
        {
          kind: "queued",
          queue_position: 1,
          waiting_on: {
            kind: typeof wait === "string" && WAITS.has(wait) ? (wait as DeliveryWait["kind"]) : "wake",
            device,
          },
        },
        data["deduplicated"] === true,
      )
    }
    if (kind === "refused") return wakeRefusal(String(data["reason"] ?? "refused"), device, data)
    const turnId = typeof data["turnId"] === "string" ? data["turnId"] : ""
    if (kind === "started" || kind === "steered") return ok({ kind, turn_id: turnId })
    if (kind === "already_admitted") return ok({ kind: "queued", queue_position: 1 }, true)
    if (kind === "held") return ok({ kind: "queued", queue_position: 1, waiting_on: { kind: "hold", device } })
    return fail(
      "idempotency_uncertain",
      `Device ${device} accepted the message but answered an unknown admission (${String(kind)}).`,
      "Retry with the same idempotency_key; a repeat of this delivery is never delivered twice.",
      { device, delivery_id: deliveryId },
    )
  }

  // The person at a terminal sends their own input: the engine's `prompt` record, raw text with no envelope (they are
  // that session's user, not a peer), kept by design (#12885). The same preflight as a session's steer, the same
  // idempotency through the tool receipt store, and the same outcome mapping as every other relay request. A person's
  // steer that names no turn steers the one this preflight reads (#13016): the state is read once, here.
  const prompt = async (
    delivery: OutboundDelivery,
    row: RemoteSessionRow,
    sending: () => void,
  ): Promise<SendOutcome> => {
    const online = await resolveTypedDevice(remote.client, row.device, { exactId: true })
    if (online.kind === "error") return online
    const ok = (kind: GatewayDeliveryDelivery): RelayDeliverySuccess => ({
      kind: "ok",
      thread_id: rowKey(row),
      delivery: kind,
      deduplicated: false,
      device: row.device,
      effective_mode: kind.kind === "steered" ? "steer" : kind.kind === "started" ? "start" : "follow_up",
    })
    if (delivery.mode === "steer") {
      const state = await remote.sessions.sessionCommand(row.device, row.session_id, {
        type: "get_state",
        sessionId: row.session_id,
      })
      if (state.kind !== "ok") return probeFailure(state, row.device)
      const engine = engineStateOf(replyData(state.response))
      if (engine.phase !== "mid_turn")
        return fail(
          REFUSAL_CODES.not_steerable.code,
          `A steer to ${row.session_id} was refused: not_steerable.`,
          REFUSAL_CODES.not_steerable.next,
          { device: row.device },
        )
      if (engine.turnEpoch === null)
        return fail(
          REFUSAL_CODES.turn_conflict.code,
          `Turn ${delivery.expected_turn_id ?? "(running)"} of ${row.session_id} cannot be confirmed on device ${row.device}.`,
          REFUSAL_CODES.turn_conflict.next,
          { device: row.device },
        )
      if (delivery.expected_turn_id !== undefined && String(engine.turnEpoch) !== delivery.expected_turn_id)
        return fail(
          REFUSAL_CODES.turn_conflict.code,
          `Turn ${delivery.expected_turn_id} is not the running turn of ${row.session_id} on device ${row.device}.`,
          REFUSAL_CODES.turn_conflict.next,
          { device: row.device, current_turn_id: String(engine.turnEpoch) },
        )
      const steer = remote.chain.stamp(
        {
          type: "prompt",
          sessionId: row.session_id,
          message: delivery.text,
          streamingBehavior: "steer",
          expectedTurnId: String(engine.turnEpoch),
        },
        1,
      )
      sending()
      const steered = await remote.sessions.sessionCommand(row.device, row.session_id, steer)
      const refusal = refusedSteer(steered)
      if (refusal !== undefined)
        return fail(
          REFUSAL_CODES[refusal].code,
          `A steer to ${row.session_id} was refused: ${refusal}.`,
          REFUSAL_CODES[refusal].next,
          { device: row.device },
        )
      if (steered.kind !== "ok") return outcomeFailure(steered, row.device)
      return ok({ kind: "steered", turn_id: String(engine.turnEpoch) })
    }
    // One round trip: the engine starts a followUp prompt on an idle session and queues it behind a running turn.
    sending()
    const sent = await remote.sessions.sessionCommand(
      row.device,
      row.session_id,
      remote.chain.stamp(
        {
          type: "prompt",
          sessionId: row.session_id,
          message: delivery.text,
          streamingBehavior: "followUp",
          ...(delivery.client_message_id === undefined ? {} : { clientMessageId: delivery.client_message_id }),
        },
        1,
      ),
    )
    if (sent.kind !== "ok") return outcomeFailure(sent, row.device)
    const reply = replyData(sent.response)
    const turnId = reply["turnId"]
    if (reply["disposition"] === "started" && typeof turnId === "string" && turnId.length > 0)
      return ok({ kind: "started", turn_id: turnId })
    const after = await remote.sessions.sessionCommand(row.device, row.session_id, {
      type: "get_state",
      sessionId: row.session_id,
    })
    const settled =
      after.kind === "ok"
        ? engineStateOf(replyData(after.response))
        : { phase: "idle" as const, turnEpoch: null, pending: null }
    // An engine whose prompt reply names no turn (engines through 2026.11.5-1) reports the running turn in get_state.
    if (reply["disposition"] === "started" && settled.turnEpoch !== null)
      return ok({ kind: "started", turn_id: String(settled.turnEpoch) })
    if (settled.pending === null)
      return fail(
        "idempotency_uncertain",
        `Device ${row.device} accepted the message but did not report where it waits.`,
        "Read the thread before deciding whether to send again.",
        { device: row.device },
      )
    return ok({ kind: "queued", queue_position: settled.pending })
  }

  return {
    deliver: async (delivery: OutboundDelivery): Promise<DeliveryOutcome> => {
      if (delivery.target.kind !== "remote")
        throw new Error("the relay transport delivers only to sessions on other devices")
      const row = delivery.target.row
      // senpi admit-external-message-command: a command_line sender is admitted only from the engine's own machine.
      if (delivery.sender.kind === "cli")
        return fail(
          "unsupported",
          `A command-line sender cannot reach a session on device ${row.device}: the engine admits a command-line delivery only from its own machine.`,
          `Use omo remote send ${row.device}/${row.session_id} instead.`,
          { device: row.device, reason: "sender_not_allowed" },
        )
      if (delivery.expected_turn_id !== undefined && !/^\d+$/.test(delivery.expected_turn_id))
        return fail(
          "turn_conflict",
          `Turn ${delivery.expected_turn_id} is not a turn of the target session.`,
          "Read the target again and steer with the turn_id a started or steered result returned.",
        )
      // The relayed delivery record has no collapse key, so the receiving device could not replace earlier repeats (#14428).
      if (delivery.collapse_key !== undefined)
        return fail(
          "unsupported",
          `collapse_key reaches sessions on this device only; the delivery to device ${row.device} was not sent.`,
          "Send without collapse_key, or send from the device that holds the thread.",
          { device: row.device, field: "collapse_key" },
        )
      if (delivery.sender.kind === "person")
        return await once(delivery.caller_id, delivery.idempotency_key, delivery.args, (_later, sending) =>
          prompt(delivery, row, sending),
        )
      if (delivery.mode === "steer" && delivery.expected_turn_id === undefined)
        return fail(
          "invalid_arguments",
          "A steer needs expected_turn_id (the target's current turn_epoch).",
          "Fix the arguments and send again.",
        )
      if (delivery.caller_id === UNKNOWN_CALLER)
        return fail(
          "caller_context_missing",
          "A gateway send needs the calling session's durable id.",
          "Retry from a session that passes its execution context.",
        )
      return await once(delivery.caller_id, delivery.idempotency_key, delivery.args, (later, sending) =>
        send(delivery, row, later, sending),
      )
    },
    dispose: () => disposed.abort(),
  }
}

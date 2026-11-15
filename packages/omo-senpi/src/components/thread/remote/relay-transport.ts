import { randomUUID } from "node:crypto"
import { rowThreadId } from "./ports"
import { threadToolFailure, type ThreadToolFailure } from "../errors"
import { hashArgs } from "../gateway/bindings"
import { decideDelivery } from "../gateway/decision"
import { senderFacts } from "../gateway/envelope"
import { deliveryProvenanceLine, renderDeliveryText } from "../gateway/provenance"
import { REFUSAL_CODES } from "../gateway/result"
import type { GatewayStore } from "../gateway/store"
import type { DeliveryOutcome, DeliveryTransport, OutboundDelivery, RelayDeliverySuccess } from "../gateway/transport"
import type { EffectiveLane, GatewayDeliveryDelivery, Provenance } from "../gateway/types"
import { UNKNOWN_CALLER } from "../tools/ports"
import type { JsonObject, RemoteSessionRow, RemoteThreadSurface } from "./ports"
import { deviceOnline, replyData } from "./remote-ops"
import { outcomeFailure } from "./outcome"

export type RelayTransportOptions = {
  readonly remote: RemoteThreadSurface
  readonly store: Pick<
    GatewayStore,
    "now" | "toolReceiptBegin" | "toolReceiptSettle" | "toolReceiptRevise" | "deliveryView"
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

type EngineState = {
  readonly phase: "idle" | "mid_turn"
  readonly turnEpoch: number | null
  readonly pending: number | null
  readonly parkedOnApproval: boolean
}

function engineStateOf(reply: JsonObject): EngineState {
  // The engine parks a turn on two kinds of approval a human must answer on that device: an open question (an ask, in
  // pendingQuestions) and a permission prompt (a dialog, in pendingDialogs). Either means the turn is not running.
  const open = (value: unknown): boolean => Array.isArray(value) && value.length > 0
  const parkedOnApproval = open(reply["pendingQuestions"]) || open(reply["pendingDialogs"])
  const midTurn = reply["isStreaming"] === true && reply["isCompacting"] !== true && !parkedOnApproval
  const current = reply["currentTurnId"]
  const turnEpoch = typeof current === "string" && /^\d+$/.test(current) ? Number(current) : null
  const pending = reply["pendingMessageCount"]
  return {
    phase: midTurn ? "mid_turn" : "idle",
    turnEpoch,
    pending: typeof pending === "number" && Number.isInteger(pending) && pending >= 1 ? pending : null,
    parkedOnApproval,
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
      if (sent.kind !== "ok") {
        log(
          `relay_delivery_failed: delivery ${deliveryId} to ${row.session_id} on device ${row.device}: re-send ${attempt + 1} ended ${sent.kind} (${sent.reason}).`,
        )
        return
      }
      const reply = replyData(sent.response)
      if (reply["kind"] === "turn_conflict") {
        // An explicit steer the draft held until its turn ended. The sender was answered queued; its receipt now answers
        // the refusal, so a retry under the same idempotency key reads what became of it (the local row's `refused`).
        const turnId = typeof reply["turnId"] === "string" ? reply["turnId"] : ""
        await revise(
          fail(
            REFUSAL_CODES.turn_conflict.code,
            `Turn ${String(record["expectedTurnId"] ?? "?")} of ${row.session_id} on device ${row.device} ended while that session's open draft held the steer; it was not delivered.`,
            REFUSAL_CODES.turn_conflict.next,
            { device: row.device, delivery_id: deliveryId, ...(turnId === "" ? {} : { current_turn_id: turnId }) },
          ),
        )
        log(
          `relay_delivery_failed: delivery ${deliveryId} to ${row.session_id} on device ${row.device}: re-send ${attempt + 1} ended turn_conflict (the steered turn ended while the draft held it); the send's receipt now answers that refusal.`,
        )
        return
      }
      if (reply["kind"] !== "held_draft") return
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
    run: (later: Later) => Promise<SendOutcome>,
  ): Promise<SendOutcome> {
    const scope = { principal: `session:${callerId}`, operation: "thread_send:remote", idempotency_key: idempotencyKey }
    const admission = await store.toolReceiptBegin({ ...scope, now: now(), args_hash: hashArgs(args) })
    if (admission.kind === "replay") {
      const first = admission.result as SendOutcome
      return first.kind === "ok" ? { ...first, deduplicated: true } : first
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
    try {
      result = await run((task) => {
        tasks.push(task)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await store
        .toolReceiptSettle({ ...scope, now: now(), error_note: message })
        .catch(unrecorded(`the send failed (${message})`))
      throw error
    }
    await store.toolReceiptSettle({ ...scope, now: now(), result }).catch(unrecorded("the send ran"))
    const revise: Revise = async (later) => {
      const revised = await store.toolReceiptRevise({ ...scope, now: now(), result: later }).catch((error: unknown) => {
        log(`relay_receipt_unrevised: ${idempotencyKey}: ${error instanceof Error ? error.message : String(error)}`)
        return true
      })
      if (!revised) log(`relay_receipt_unrevised: ${idempotencyKey}: no settled receipt of this process to revise.`)
    }
    for (const task of tasks) void task(revise)
    return result
  }

  async function chain(
    callerId: string,
  ): Promise<{ readonly delivery_id: string; readonly root_id: string; readonly hop: number }> {
    const cause = options.callerCause?.()
    const prior = cause === undefined ? undefined : (await store.deliveryView(cause))?.row
    return {
      delivery_id: randomUUID(),
      root_id: prior?.root_id ?? `root-${randomUUID()}`,
      hop: Math.max(prior?.hop ?? 0, options.callerChainHop?.() ?? 0) + 1,
    }
  }

  async function send(delivery: OutboundDelivery, row: RemoteSessionRow, later: Later): Promise<SendOutcome> {
    const offline = await deviceOnline(remote, row.device)
    if (offline !== undefined) return offline
    const expected = delivery.expected_turn_id === undefined ? null : Number(delivery.expected_turn_id)
    let lane: EffectiveLane = "follow_up"
    let steerTurn: number | null = null
    let probedState: EngineState | undefined
    // One get_state decides the lane the way the local drain does (gateway/decision.ts): a steer must name the running
    // turn, and the default (auto) steers whatever turn is running and starts one when the target is idle.
    if (delivery.mode === "steer" || delivery.mode === "auto") {
      const probed = await remote.sessions.sessionCommand(row.device, row.session_id, {
        type: "get_state",
        sessionId: row.session_id,
      })
      if (probed.kind !== "ok") return outcomeFailure(probed, row.device)
      const state: EngineState = engineStateOf(replyData(probed.response))
      probedState = state
      const decision = decideDelivery(state.phase, delivery.mode, expected, state.turnEpoch)
      if (decision.kind !== "admit") {
        const reason = decision.kind === "refuse" ? decision.reason : "turn_conflict"
        const mapped = REFUSAL_CODES[reason] ?? {
          code: "internal_error" as const,
          next: "Call thread_list and check the target.",
        }
        return fail(
          mapped.code,
          `A steer to ${row.session_id} on device ${row.device} was refused: ${reason}.`,
          mapped.next,
          { device: row.device, ...(state.turnEpoch === null ? {} : { current_turn_id: String(state.turnEpoch) }) },
        )
      }
      if (decision.deliverAs === "steer") {
        lane = "steer"
        steerTurn = decision.expected_turn_id ?? expected
      }
    }
    const facts = senderFacts(delivery.sender, await options.senderProvenance())
    const { delivery_id, root_id, hop } = await chain(delivery.caller_id)
    const name = delivery.sender.kind === "session" ? delivery.sender.name?.trim() : undefined
    const recordFor = (effective: EffectiveLane) =>
      remote.chain.stamp(
        {
          type: ADMIT_RECORD,
          sessionId: row.session_id,
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
            },
            body: delivery.text,
            mode_requested: delivery.mode,
            mode_effective: effective,
            binding_id: null,
            binding_revision: null,
          }),
          displayText: `${deliveryProvenanceLine(facts.provenance)}\n${delivery.text}`,
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
    const ok = (kind: GatewayDeliveryDelivery, deduplicated = false): RelayDeliverySuccess => ({
      kind: "ok",
      thread_id: rowThreadId(row),
      delivery: kind,
      deduplicated,
      device: row.device,
      delivery_id,
      effective_mode: lane,
    })
    let sent = await remote.sessions.sessionCommand(row.device, row.session_id, record)
    if (
      delivery.mode === "auto" &&
      lane === "steer" &&
      sent.kind === "ok" &&
      replyData(sent.response)["kind"] === "turn_conflict"
    ) {
      // The turn the probe saw ended before the record arrived. The default never fails on that race: it takes the lane the
      // target has now (started when idle, queued behind a turn that began since), as a local drain re-decides at admission.
      lane = "follow_up"
      record = recordFor(lane)
      sent = await remote.sessions.sessionCommand(row.device, row.session_id, record)
    }
    if (sent.kind === "refused" && (ADMIT_UNSUPPORTED.has(sent.reason) || sent.reason.startsWith("Unknown command")))
      return fail(
        "unsupported",
        `Device ${row.device} runs an engine without admit_external_message (${sent.reason}); a peer message cannot be delivered there as a delivery.`,
        "Update omo and senpi on that device, then retry.",
        { device: row.device, reason: sent.reason },
      )
    if (sent.kind !== "ok") return outcomeFailure(sent, row.device)
    const reply = replyData(sent.response)
    const kind = reply["kind"]
    const turnId = typeof reply["turnId"] === "string" ? reply["turnId"] : ""
    if (kind === "started" || kind === "steered") return ok({ kind, turn_id: turnId })
    if (kind === "turn_conflict")
      return fail(
        REFUSAL_CODES.turn_conflict.code,
        `Turn ${delivery.expected_turn_id ?? "?"} is no longer the running turn of ${row.session_id} on device ${row.device}.`,
        REFUSAL_CODES.turn_conflict.next,
        { device: row.device, ...(turnId === "" ? {} : { current_turn_id: turnId }) },
      )
    if (kind !== "queued" && kind !== "held_draft" && kind !== "already_admitted")
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
      // turn that may have ended by the time the draft goes (turn_conflict, silently lost); the re-sends take the lane
      // the local drain would re-decide at admission, followUp, and the sender's answer names that lane.
      if (delivery.mode === "auto" && lane === "steer") {
        lane = "follow_up"
        record = recordFor(lane)
      }
      later((revise) => retryHeld(row, record, delivery_id, revise))
    }
    // An idle receiver reports pendingMessageCount 0 while it holds (held_draft) or already took (already_admitted) the
    // delivery: the message is still first in line there, so those two kinds answer position 1, never uncertain.
    // A receiver parked on an approval (an open question its human must answer on that device) reports no queue
    // position while it holds the message: the delivery is not uncertain, it waits behind that approval (#12886).
    if (kind === "queued" && afterState?.parkedOnApproval === true)
      return ok({ kind: "queued", queue_position: pending ?? 1, waiting_on: { kind: "approval", device: row.device } })
    if (kind === "queued" && pending === null)
      return fail(
        "idempotency_uncertain",
        `Device ${row.device} accepted the message but did not report where it waits.`,
        "Read the thread before deciding whether to send again.",
        { device: row.device, delivery_id },
      )
    return ok({ kind: "queued", queue_position: pending ?? 1 }, kind === "already_admitted")
  }

  // The person at a terminal sends their own input: the engine's `prompt` record, raw text with no envelope (they are
  // that session's user, not a peer), kept by design (#12885). The same preflight as a session's steer, the same
  // idempotency through the tool receipt store, and the same outcome mapping as every other relay request. A person's
  // steer that names no turn steers the one this preflight reads (#13016): the state is read once, here.
  const prompt = async (delivery: OutboundDelivery, row: RemoteSessionRow): Promise<SendOutcome> => {
    const offline = await deviceOnline(remote, row.device)
    if (offline !== undefined) return offline
    const ok = (kind: GatewayDeliveryDelivery): RelayDeliverySuccess => ({
      kind: "ok",
      thread_id: rowThreadId(row),
      delivery: kind,
      deduplicated: false,
      device: row.device,
      effective_mode: delivery.mode === "steer" ? "steer" : "follow_up",
    })
    if (delivery.mode === "steer") {
      const state = await remote.sessions.sessionCommand(row.device, row.session_id, {
        type: "get_state",
        sessionId: row.session_id,
      })
      if (state.kind !== "ok") return outcomeFailure(state, row.device)
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
      const steered = await remote.sessions.sessionCommand(row.device, row.session_id, steer)
      if (steered.kind === "refused" && (steered.reason === "turn_conflict" || steered.reason === "not_steerable"))
        return fail(
          REFUSAL_CODES[steered.reason].code,
          `A steer to ${row.session_id} was refused: ${steered.reason}.`,
          REFUSAL_CODES[steered.reason].next,
          { device: row.device },
        )
      if (steered.kind !== "ok") return outcomeFailure(steered, row.device)
      return ok({ kind: "steered", turn_id: String(engine.turnEpoch) })
    }
    // One round trip: the engine starts a followUp prompt on an idle session and queues it behind a running turn.
    const sent = await remote.sessions.sessionCommand(
      row.device,
      row.session_id,
      remote.chain.stamp(
        { type: "prompt", sessionId: row.session_id, message: delivery.text, streamingBehavior: "followUp" },
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
      if (delivery.sender.kind === "person")
        return await once(delivery.caller_id, delivery.idempotency_key, delivery.args, () => prompt(delivery, row))
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
      return await once(delivery.caller_id, delivery.idempotency_key, delivery.args, (later) =>
        send(delivery, row, later),
      )
    },
    dispose: () => disposed.abort(),
  }
}

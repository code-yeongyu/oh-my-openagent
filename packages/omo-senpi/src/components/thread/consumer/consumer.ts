import { GatewayMigrationError } from "../gateway/store-ops"
import type { GatewayStore } from "../gateway/store"
import type { IntakeOutcome, IntakeRecord } from "../gateway/types"
import { findDiskSessions } from "../address-book"
import { resolveWakeTarget } from "../wake/session-target"
import { decodeServeAck, refusalCode, type DeliveryInboundEvent, type DeliveryServicePort } from "./port"
import { receiptOutcomeOf } from "../remote/receipt"

const DELIVERY_PROTOCOL_VERSION = 1

export type ConsumerStart = "serving" | "unsupported" | "schema_too_new"

export type DeliveryConsumerOptions = {
  readonly store: GatewayStore
  readonly port: DeliveryServicePort
  readonly agentDir: string
  readonly sessionsDirectory: string
  /**
   * The user's `threads.chainCountLimit` for the target session's cwd, read at each intake as the running engine reads
   * it at each admission (senpi `admitInputChain` over `SettingsManager.getThreadChainCountLimit`), so a queued delivery
   * past the limit is refused like a live one. `undefined` means the user set no limit.
   */
  readonly chainCountLimit: (cwd: string) => Promise<number | undefined>
  /** Starts the session (the carrier's wake); called only after the sender passed the admission check. */
  readonly wake: (durableId: string) => Promise<void>
  /** A tracked step that failed (a wake, an answer, a held reply): reported here, never left as an unhandled rejection. */
  readonly onError?: (error: unknown) => void
}

export type DeliveryConsumer = {
  readonly start: () => Promise<ConsumerStart>
  /** From this start's acknowledgement until the consumer stops: the service hands this consumer its deliveries. */
  readonly serving: () => boolean
  /** One `delivery.drained` report per marked pair whose intake rows are all applied (the newest answered command id). */
  readonly reportDrained: () => Promise<void>
  readonly idle: () => Promise<void>
  readonly stop: () => void
}

function intakeRecord(event: DeliveryInboundEvent): IntakeRecord | undefined {
  const record = event.record
  const sender = record.sender
  if (
    typeof record.deliveryId !== "string" ||
    typeof record.text !== "string" ||
    typeof record.displayText !== "string" ||
    typeof sender !== "object" ||
    sender === null ||
    typeof (sender as { kind?: unknown }).kind !== "string" ||
    (record.deliverAs !== "followUp" && record.deliverAs !== "steer") ||
    typeof record.chainCount !== "number"
  )
    return undefined
  return {
    sessionId: event.durable_id,
    deliveryId: record.deliveryId,
    text: record.text,
    displayText: record.displayText,
    sender: sender as IntakeRecord["sender"],
    deliverAs: record.deliverAs,
    chainCount: record.chainCount,
  }
}

const UNKNOWN_SHAPE = new Set(["unknown_type", "unsupported"])

/** The numbers a refusal's details carry to the sender: a chain limit's counts, the pair loop guard's burst and wait. */
const REFUSAL_NUMBERS = ["chain_count", "limit", "burst", "window_ms", "retry_after_ms"] as const

/**
 * The answer for a record the intake refused. The store names the precise cause in `details.reason` (for example
 * `chain_count_limit`, with `chain_count` and `limit`); the sender maps that reason (`relay-transport.ts` `wakeRefusal`),
 * so it is sent in place of the coarse tool code, which stays the reason only when the store named none (the pair loop
 * guard: `pair_loop_guard`, with `burst`, `window_ms` and `retry_after_ms`).
 */
function intakeRefusal(refusal: Extract<IntakeOutcome, { kind: "refused" }>): Record<string, unknown> {
  const details = refusal.details ?? {}
  const reason = typeof details["reason"] === "string" ? details["reason"] : refusal.code
  const counts = Object.fromEntries(
    REFUSAL_NUMBERS.flatMap((key) => (typeof details[key] === "number" ? [[key, details[key]]] : [])),
  )
  return { kind: "refused", reason, ...counts }
}

/**
 * The engine side of the delivery protocol (#13037 5.4, 5.12, A2.4, A2.14). A handed record is resolved here first
 * (gone, ambiguous and child sessions are refused before anything is committed), then committed through the intake and
 * answered from the row; only after the answer does the consumer ask whether the sender is still admitted, and only a
 * yes wakes the session. A no settles the row refused. The pending list is reported after every declaration.
 */
export function createDeliveryConsumer(options: DeliveryConsumerOptions): DeliveryConsumer {
  const { store, port } = options
  const follow = new Set<Promise<void>>()
  let marksKept = true
  let serving = false
  let unsubscribe: (() => void)[] = []

  const track = (work: Promise<void>): void => {
    const settled = work.catch((error: unknown) => options.onError?.(error))
    follow.add(settled)
    void settled.finally(() => follow.delete(settled))
  }

  const settleAfterAnswer = async (event: DeliveryInboundEvent, rowId: string): Promise<void> => {
    let admitted: boolean
    try {
      admitted = await port.peerAdmitted(event.sender_device)
    } catch {
      return
    }
    if (!admitted) {
      await store.refuseQueued({ now: store.now(), delivery_id: rowId, reason: "sender_not_admitted" })
      return
    }
    await options.wake(event.durable_id)
  }

  /**
   * The reply is the engine's RPC response envelope, as the live path answers the same record (A5 addendum 2).
   * `unknown_delivery`: the service no longer waits on this pair; the row stays and the wake goes on (A5.1).
   */
  const answer = async (
    pair: { readonly sender_device: string; readonly command_id: string },
    reply: Record<string, unknown>,
  ): Promise<void> => {
    try {
      await port.answer(pair, { type: "response", success: true, data: reply })
    } catch (error) {
      if (refusalCode(error) !== "unknown_delivery") throw error
    }
  }

  const onInbound = async (event: DeliveryInboundEvent): Promise<void> => {
    if (event.record["type"] === "delivery_outcome_notice") {
      const pair = { sender_device: event.sender_device, command_id: event.command_id }
      if (!(await port.peerAdmitted(event.sender_device))) {
        await answer(pair, { kind: "refused", reason: "sender_not_admitted" })
        return
      }
      const id = event.record["deliveryId"]
      const outcome = receiptOutcomeOf({ kind: "refused", reason: event.record["reason"] })
      if (typeof id === "string" && outcome.kind === "refused") {
        const principal = `session:${event.durable_id}`
        const held = await store.remoteReceipt({ now: store.now(), principal, delivery_id: id })
        if (
          held !== null &&
          held.result.device === event.sender_device &&
          held.result.thread_id === event.record["targetSessionId"] &&
          (await port.peerAdmitted(event.sender_device))
        )
          await store.reconcileRemoteReceipt({
            now: store.now(),
            principal,
            idempotency_key: held.idempotency_key,
            delivery_id: id,
            device: event.sender_device,
            target_durable_id: held.result.thread_id,
            outcome,
          })
      }
      // A missing receipt, a duplicate and a kept notice have the same acknowledgment.
      await answer(pair, { accepted: true })
      return
    }
    if (event.record["type"] === "get_delivery_outcome") {
      const pair = { sender_device: event.sender_device, command_id: event.command_id }
      // The service attests the device principal and checks its grant again after this answer.
      // Check here too, before touching a transcript or returning any receipt state.
      if (!(await port.peerAdmitted(event.sender_device))) {
        await answer(pair, { kind: "refused", reason: "sender_not_admitted" })
        return
      }
      const deliveryId = event.record["deliveryId"]
      if (typeof deliveryId !== "string") {
        await answer(pair, { outcome: { kind: "outcome_unavailable" } })
        return
      }
      const target = resolveWakeTarget(options.sessionsDirectory, event.durable_id)
      const outcome = await store.receiptOutcome({
        now: store.now(),
        principal: `device:${event.sender_device}`,
        delivery_id: deliveryId,
        target_durable_id: event.durable_id,
        ...(target.kind === "found" ? { session_path: target.session_path } : {}),
      })
      if (!(await port.peerAdmitted(event.sender_device))) {
        await answer(pair, { kind: "refused", reason: "sender_not_admitted" })
        return
      }
      await answer(pair, { outcome })
      return
    }
    const target = resolveWakeTarget(options.sessionsDirectory, event.durable_id)
    const reason =
      target.kind === "gone"
        ? "session_gone"
        : target.kind === "ambiguous"
          ? "ambiguous_session"
          : target.session_kind !== "interactive"
            ? "not_wakeable"
            : undefined
    const pair = { sender_device: event.sender_device, command_id: event.command_id }
    const record = intakeRecord(event)
    if (target.kind !== "found" || reason !== undefined || record === undefined) {
      await answer(pair, { kind: "refused", reason: reason ?? "invalid_record" })
      return
    }
    // A limit that cannot be read (the settings barrel failed to load) fails open: the delivery is queued as it was before
    // the limit was wired, and the failure is reported, so the sender never waits on a delivery nobody answered.
    const chainCountLimit = await options.chainCountLimit(target.cwd).catch((error: unknown) => {
      options.onError?.(error)
      return undefined
    })
    const outcome = await store.intake({
      now: store.now(),
      attested_device: event.sender_device,
      record,
      provenance: { workspace: "remote", project: "remote" },
      target_session_kind: "interactive",
      ...(chainCountLimit === undefined ? {} : { chain_count_limit: chainCountLimit }),
    })
    if (outcome.kind === "busy") {
      await answer(pair, { kind: "refused", reason: "busy" })
      return
    }
    if (outcome.kind === "refused") {
      await answer(pair, intakeRefusal(outcome))
      return
    }
    if (!outcome.deduplicated)
      await store.intakeMarks.record({
        sender_device: event.sender_device,
        session_id: event.durable_id,
        command_id: event.command_id,
        ledger_id: outcome.ledger_id,
      })
    const storedCommand = outcome.deduplicated
      ? ((await store.intakeMarks.commandFor({ ledger_id: outcome.ledger_id })) ?? event.command_id)
      : event.command_id
    await answer(pair, {
      kind: "queued",
      stored_command_id: storedCommand,
      delivery_id: outcome.delivery_id,
      queue_position: outcome.queue_position,
      deduplicated: outcome.deduplicated,
      waiting_on: (await store.sessionWait.waitingOn({ durable_id: event.durable_id })) ?? { kind: "wake" },
    })
    track(settleAfterAnswer(event, outcome.row_id))
  }

  const reportPending = async (): Promise<void> => {
    if (!marksKept) return
    try {
      await port.pending(await store.intakeMarks.pending())
    } catch (error) {
      if (UNKNOWN_SHAPE.has(refusalCode(error) ?? "")) marksKept = false
    }
  }

  return {
    serving: () => serving,
    start: async () => {
      try {
        await store.identity()
      } catch (error) {
        if (error instanceof GatewayMigrationError || /schema/i.test(String(error))) return "schema_too_new"
        throw error
      }
      // The service hands its waiting records right after the acknowledgement, on the same connection, so the listeners
      // are in place before the declaration is sent.
      unsubscribe = [
        port.onInbound((event) => track(onInbound(event))),
        port.onHolds((event) => {
          const holds = findDiskSessions(options.sessionsDirectory, event.durable_id, { id_only: true }).length > 0
          track(port.held(event.ask_id, holds))
        }),
      ]
      const unsubscribeAll = (): void => {
        for (const off of unsubscribe) off()
        unsubscribe = []
      }
      let ack: unknown
      try {
        ack = await port.serve({ agent_dir: options.agentDir, v: DELIVERY_PROTOCOL_VERSION })
      } catch (error) {
        unsubscribeAll()
        if (UNKNOWN_SHAPE.has(refusalCode(error) ?? "")) return "unsupported"
        throw error
      }
      const decoded = decodeServeAck(ack)
      if (decoded === undefined) {
        unsubscribeAll()
        return "unsupported"
      }
      serving = true
      await reportPending()
      return "serving"
    },
    reportDrained: async () => {
      if (port.notice !== undefined) {
        for (const notice of await store.refusalNotices(store.now())) {
          if (!(await port.peerAdmitted(notice.device))) {
            await store.claimRefusalNotice({ now: store.now(), notice, suppress: true })
            continue
          }
          if (!(await store.claimRefusalNotice({ now: store.now(), notice }))) continue
          if (!(await port.peerAdmitted(notice.device))) continue
          await port.notice(notice).catch((error: unknown) => options.onError?.(error))
        }
      }
      if (!marksKept) return
      for (const pair of await store.intakeMarks.marked()) {
        const result = await store.intakeMarks.drained(pair)
        if (!result.drained) continue
        try {
          const reply = await port.drained({ ...pair, last_command_id: result.last_command_id })
          if (
            reply.kept &&
            !(await store.intakeMarks.openForCommand({
              sender_device: pair.sender_device,
              command_id: reply.expecting,
            }))
          )
            await port.drained({ ...pair, last_command_id: reply.expecting })
        } catch (error) {
          if (UNKNOWN_SHAPE.has(refusalCode(error) ?? "")) {
            marksKept = false
            return
          }
        }
      }
    },
    idle: async () => {
      while (follow.size > 0) await Promise.allSettled([...follow])
    },
    stop: () => {
      for (const off of unsubscribe) off()
      unsubscribe = []
      serving = false
    },
  }
}

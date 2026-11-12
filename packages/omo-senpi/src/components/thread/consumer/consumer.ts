import { GatewayMigrationError } from "../gateway/store-ops"
import type { GatewayStore } from "../gateway/store"
import type { IntakeRecord } from "../gateway/types"
import { findDiskSessions } from "../address-book"
import { resolveWakeTarget } from "../wake/session-target"
import { decodeServeAck, refusalCode, type DeliveryInboundEvent, type DeliveryServicePort } from "./port"

const DELIVERY_PROTOCOL_VERSION = 1

export type ConsumerStart = "serving" | "unsupported" | "schema_too_new"

export type DeliveryConsumerOptions = {
  readonly store: GatewayStore
  readonly port: DeliveryServicePort
  readonly agentDir: string
  readonly sessionsDirectory: string
  /** Starts the session (the carrier's wake); called only after the sender passed the admission check. */
  readonly wake: (durableId: string) => Promise<void>
}

export type DeliveryConsumer = {
  readonly start: () => Promise<ConsumerStart>
  /**
   * The receiving device's wake switch as this consumer was told it on its own connection (A7.2.3): off until an
   * acknowledgement names it, off again when the connection is dropped, and the carrier's gate for a row from
   * another device.
   */
  readonly wakeAllowed: () => boolean
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
  let wakeAllowed = false
  let unsubscribe: (() => void)[] = []

  const track = (work: Promise<void>): void => {
    follow.add(work)
    void work.finally(() => follow.delete(work))
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
    if (reason !== undefined || record === undefined) {
      await answer(pair, { kind: "refused", reason: reason ?? "invalid_record" })
      return
    }
    const outcome = await store.intake({
      now: store.now(),
      attested_device: event.sender_device,
      record,
      provenance: { workspace: "remote", project: "remote" },
      target_session_kind: "interactive",
    })
    if (outcome.kind !== "queued") {
      await answer(pair, { kind: "refused", reason: outcome.kind === "busy" ? "busy" : outcome.code })
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
    wakeAllowed: () => wakeAllowed,
    start: async () => {
      try {
        await store.identity()
      } catch (error) {
        if (error instanceof GatewayMigrationError || /schema/i.test(String(error))) return "schema_too_new"
        throw error
      }
      let ack: unknown
      try {
        ack = await port.serve({ agent_dir: options.agentDir, v: DELIVERY_PROTOCOL_VERSION })
      } catch (error) {
        if (UNKNOWN_SHAPE.has(refusalCode(error) ?? "")) return "unsupported"
        throw error
      }
      const decoded = decodeServeAck(ack)
      if (decoded === undefined) return "unsupported"
      wakeAllowed = decoded.wake ?? false
      unsubscribe = [
        port.onWake((enabled) => {
          wakeAllowed = enabled === true
        }),
        port.onInbound((event) => track(onInbound(event))),
        port.onHolds((event) => {
          const holds = findDiskSessions(options.sessionsDirectory, event.durable_id, { id_only: true }).length > 0
          track(port.held(event.ask_id, holds))
        }),
      ]
      await reportPending()
      return "serving"
    },
    reportDrained: async () => {
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
      wakeAllowed = false
    },
  }
}

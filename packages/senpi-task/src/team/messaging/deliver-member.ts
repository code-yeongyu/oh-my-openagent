import {
  commitDeliveryReservation,
  releaseDeliveryReservation,
  reserveMessageForDelivery,
} from "@oh-my-opencode/team-core/team-mailbox"
import type { DeliveryReservation } from "@oh-my-opencode/team-core/team-mailbox"

import { log } from "@oh-my-opencode/utils"

import { messageability } from "../../state"
import type { TeamCoreConfig } from "../runtime-config"
import { buildPeerMessageEnvelope } from "./message"
import type { MemberDeliveryResult, MemberTaskMap, Message, MessagingDeliveryPort } from "./types"

export type DeliverToMemberInput = {
  readonly message: Message
  readonly recipient: string
  readonly teamRunId: string
  readonly config: TeamCoreConfig
  readonly memberTaskMap: MemberTaskMap
  readonly delivery: MessagingDeliveryPort
}

const REVIVE_ACCEPTED = new Set(["revived", "steered", "queued"])

/**
 * Delivers one already-written inbox message to its recipient member using OUR OWN task-store liveness
 * (never team-core session-liveness). A resident running child is steered directly; an idle or
 * terminal-resident child is revived via the steering engine's followUp path (todo 10); a
 * non-continuable child is left unread for the on-revive injection fallback. Live paths reserve the
 * message first and commit on success (moving it to `processed/`) or release on failure (redeliverable).
 */
export async function deliverToMember(input: DeliverToMemberInput): Promise<MemberDeliveryResult> {
  const { message, recipient, teamRunId, config, memberTaskMap, delivery } = input
  const messageId = message.messageId

  const taskId = memberTaskMap[recipient]
  if (taskId === undefined) return leftUnread(recipient, messageId, "no-task-mapping")

  const record = delivery.get(taskId)
  if (record === undefined) return leftUnread(recipient, messageId, "no-record")

  const mode = messageability(record.status, record.residency_state)
  if (mode === "not-continuable") return leftUnread(recipient, messageId, "not-continuable")

  const reservation = await reserveMessageForDelivery(teamRunId, recipient, messageId, config)
  if (reservation === null) {
    return { kind: "delivery_failed", member: recipient, messageId, reason: "reservation-lost" }
  }

  const envelope = buildPeerMessageEnvelope(message)
  if (mode === "steer") {
    return steerDelivery({ ...input, taskId, reservation, envelope })
  }
  return reviveDelivery({ ...input, taskId, reservation, envelope })
}

type PathInput = DeliverToMemberInput & {
  readonly taskId: string
  readonly reservation: DeliveryReservation
  readonly envelope: string
}

async function steerDelivery(input: PathInput): Promise<MemberDeliveryResult> {
  const { recipient, message, delivery, taskId, reservation, envelope } = input
  const handle = delivery.liveHandle(taskId)
  if (handle === undefined) {
    await releaseDeliveryReservation(reservation)
    return leftUnread(recipient, message.messageId, "no-live-handle")
  }
  try {
    await handle.steer(envelope)
    await commitDeliveryReservation(reservation)
    return { kind: "steered", member: recipient, messageId: message.messageId }
  } catch (error) {
    await releaseDeliveryReservation(reservation)
    log("senpi-task team message steer failed, reservation released", {
      teamRunId: input.teamRunId,
      recipient,
      messageId: message.messageId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { kind: "delivery_failed", member: recipient, messageId: message.messageId, reason: "steer-threw" }
  }
}

async function reviveDelivery(input: PathInput): Promise<MemberDeliveryResult> {
  const { recipient, message, delivery, taskId, reservation, envelope } = input
  const outcome = await delivery.sendToTask({ idOrName: taskId, message: envelope, deliverAs: "followUp" })
  if (REVIVE_ACCEPTED.has(outcome.kind)) {
    await commitDeliveryReservation(reservation)
    return { kind: "revived", member: recipient, messageId: message.messageId }
  }
  await releaseDeliveryReservation(reservation)
  return { kind: "delivery_failed", member: recipient, messageId: message.messageId, reason: outcome.kind }
}

function leftUnread(member: string, messageId: string, reason: string): MemberDeliveryResult {
  return { kind: "left_unread", member, messageId, reason }
}

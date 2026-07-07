import { randomUUID } from "node:crypto"

import {
  commitDeliveryReservation,
  releaseDeliveryReservation,
  reserveMessageForDelivery,
} from "@oh-my-opencode/team-core/team-mailbox"
import type { DeliveryReservation } from "@oh-my-opencode/team-core/team-mailbox"

import { log } from "@oh-my-opencode/utils"

import { messageability } from "../../state"
import type { TeamCoreConfig } from "../runtime-config"
import { ackMemberInjection, buildMemberUnreadInjection, releaseMemberInjection } from "./inject"
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
  return reviveDelivery({
    ...input,
    taskId,
    reservation,
    envelope,
    sessionId: record.child_session_id ?? taskId,
    turnMarker: `revive:${messageId}:${randomUUID()}`,
  })
}

type PathInput = DeliverToMemberInput & {
  readonly taskId: string
  readonly reservation: DeliveryReservation
  readonly envelope: string
}

type RevivePathInput = PathInput & {
  readonly sessionId: string
  readonly turnMarker: string
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

// The revive path also drains whatever the recipient left unread from earlier failed live deliveries:
// the batched injection envelope is prepended to the current message so a single followUp turn consumes
// the whole backlog. The current message rides the reservation track (commit/release); the prior-unread
// batch rides the injection track (ack on success, release on failure) so neither can leak on a
// non-accepted revive.
async function reviveDelivery(input: RevivePathInput): Promise<MemberDeliveryResult> {
  const { recipient, message, delivery, taskId, reservation, envelope, teamRunId, config, sessionId, turnMarker } = input
  const injection = await buildMemberUnreadInjection({ sessionId, memberName: recipient, teamRunId, config, turnMarker })
  const prompt = injection.injected && injection.content !== undefined ? `${injection.content}\n${envelope}` : envelope

  const outcome = await delivery.sendToTask({ idOrName: taskId, message: prompt, deliverAs: "followUp" })
  if (REVIVE_ACCEPTED.has(outcome.kind)) {
    await commitDeliveryReservation(reservation)
    await ackMemberInjection({ memberName: recipient, teamRunId, messageIds: injection.messageIds, config })
    return { kind: "revived", member: recipient, messageId: message.messageId }
  }
  await releaseDeliveryReservation(reservation)
  await releaseMemberInjection({ memberName: recipient, teamRunId, messageIds: injection.messageIds, config })
  return { kind: "delivery_failed", member: recipient, messageId: message.messageId, reason: outcome.kind }
}

function leftUnread(member: string, messageId: string, reason: string): MemberDeliveryResult {
  return { kind: "left_unread", member, messageId, reason }
}

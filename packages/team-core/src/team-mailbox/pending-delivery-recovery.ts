import type { TeamModeConfig } from "../config"
import { isRecord } from "@oh-my-opencode/utils"
import { log } from "../logger"
import { releaseDeliveryReservation, reserveMessageForDelivery } from "./reservation"

type SessionMessagesClient = {
  session?: {
    messages?: (input: { path: { id: string } }) => Promise<unknown>
  }
}

function getMessagesData(response: unknown): unknown[] {
  if (isRecord(response) && Array.isArray(response.data)) {
    return response.data
  }
  return Array.isArray(response) ? response : []
}

function valueContainsMessageId(value: unknown, messageId: string): boolean {
  if (typeof value === "string") {
    return value.includes(messageId)
  }
  if (Array.isArray(value)) {
    return value.some((entry) => valueContainsMessageId(entry, messageId))
  }
  if (isRecord(value)) {
    return Object.values(value).some((entry) => valueContainsMessageId(entry, messageId))
  }
  return false
}

/**
 * Returns the subset of messageIds whose live-delivery envelope is present in the
 * recipient session's message history. A live/poll-injected peer message embeds
 * its messageId in the injected `<peer_message messageId="...">` envelope, so a
 * message that genuinely reached the recipient's context is detectable here.
 *
 * Messages NOT returned were marked "pending" (the wake/dispatch was accepted) but
 * never actually entered context - acking those would silently lose them.
 *
 * On any error (or when the client cannot read messages) returns an empty set,
 * which is the loss-safe answer: callers requeue rather than ack.
 */
export async function findDeliveredMessageIds(
  client: SessionMessagesClient,
  sessionID: string,
  messageIds: readonly string[],
): Promise<Set<string>> {
  const delivered = new Set<string>()
  if (messageIds.length === 0 || typeof client.session?.messages !== "function") {
    return delivered
  }

  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = getMessagesData(response)
    for (const messageId of messageIds) {
      if (messages.some((message) => valueContainsMessageId(message, messageId))) {
        delivered.add(messageId)
      }
    }
  } catch (error) {
    log("[team-mailbox] failed to read session history for pending-delivery verification", {
      sessionID,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return delivered
}

/**
 * Returns reserved (`.delivering-<id>.json`) pending messages to the inbox as
 * normal unread (`<id>.json`) files so the next poll-injection / wake-hint can
 * re-deliver them. Used when a pending live delivery is found to have never
 * reached the recipient's context.
 */
export async function requeuePendingLiveDeliveries(
  teamRunId: string,
  memberName: string,
  messageIds: readonly string[],
  config: TeamModeConfig,
): Promise<void> {
  for (const messageId of messageIds) {
    const reservation = await reserveMessageForDelivery(teamRunId, memberName, messageId, config)
    if (reservation === null) {
      continue
    }
    await releaseDeliveryReservation(reservation)
  }
}

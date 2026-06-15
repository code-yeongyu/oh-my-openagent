import { isRecord } from "@oh-my-opencode/utils"
import type { TeamModeConfig } from "../config"
import { log } from "../logger"
import type { TeamSessionContext } from "../session-client"
import { ackMessages } from "../team-mailbox/ack"
import { reclaimStaleReservations } from "../team-mailbox/reservation"
import type { RuntimeStateMember } from "../types"
import { transitionRuntimeState } from "./store"



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

async function findAcceptedReclaimedMessageIds(
  ctx: TeamSessionContext,
  member: RuntimeStateMember,
  messageIds: readonly string[],
): Promise<string[]> {
  if (messageIds.length === 0 || member.sessionId === undefined) {
    return []
  }

  try {
    const messagesLoader = ctx.client.session.messages
    if (messagesLoader === undefined) {
      return []
    }
    const response = await messagesLoader({ path: { id: member.sessionId } })
    const messages = getMessagesData(response)
    return messageIds.filter((messageId) => messages.some((message) => valueContainsMessageId(message, messageId)))
  } catch (historyError) {
    log("team mailbox reclaimed reservation history check failed", {
      event: "team-mailbox-reclaim-history-check-failed",
      member: member.name,
      sessionID: member.sessionId,
      error: historyError instanceof Error ? historyError.message : String(historyError),
    })
    return []
  }
}

async function reconcileReclaimedReservations(
  ctx: TeamSessionContext,
  teamRunId: string,
  member: RuntimeStateMember,
  reclaimedMessageIds: readonly string[],
  config: TeamModeConfig,
): Promise<void> {
  if (reclaimedMessageIds.length === 0) {
    return
  }

  const acceptedMessageIds = await findAcceptedReclaimedMessageIds(ctx, member, reclaimedMessageIds)
  if (acceptedMessageIds.length > 0) {
    await ackMessages(teamRunId, member.name, acceptedMessageIds, config)
  }

  const reclaimedMessageIdSet = new Set(reclaimedMessageIds)
  await transitionRuntimeState(teamRunId, (currentRuntimeState) => ({
    ...currentRuntimeState,
    members: currentRuntimeState.members.map((currentMember) => (
      currentMember.name === member.name
        ? {
          ...currentMember,
          pendingInjectedMessageIds: currentMember.pendingInjectedMessageIds.filter((messageId) => !reclaimedMessageIdSet.has(messageId)),
        }
        : currentMember
    )),
  }), config)
}

export async function reconcileStaleReservationsForMember(
  ctx: TeamSessionContext,
  teamRunId: string,
  member: RuntimeStateMember,
  config: TeamModeConfig,
  staleReservationTtlMs: number,
): Promise<void> {
  const reclaimedMessageIds = await reclaimStaleReservations(
    teamRunId,
    member.name,
    config,
    staleReservationTtlMs,
  )
  await reconcileReclaimedReservations(ctx, teamRunId, member, reclaimedMessageIds, config)
}

import type { TeamModeConfig } from "../../config/schema/team-mode"
import { ackMessages } from "../../features/team-mode/team-mailbox/ack"
import {
  releaseDeliveryReservation,
  reserveMessageForDelivery,
} from "../../features/team-mode/team-mailbox/reservation"
import { transitionRuntimeState } from "../../features/team-mode/team-state-store/store"
import { log } from "../../shared/logger"
import { isRecord } from "../../shared/record-type-guard"
import { isSessionActive, settleAfterSessionIdle } from "../../shared/session-idle-settle"

export type SessionStatusApi = () => Promise<unknown>
export type SessionMessagesApi = (input: { path: { id: string } }) => Promise<unknown>

export type LiveDeliveryRecoveryClient = {
  session: {
    status?: SessionStatusApi
    messages?: SessionMessagesApi
  }
}

export type ProcessPendingLiveDeliveriesInput = {
  client: LiveDeliveryRecoveryClient
  teamRunId: string
  memberName: string
  sessionID: string
  pendingInjectedMessageIds: readonly string[]
  config: TeamModeConfig
  idleSettleMs?: number
}

export type ProcessPendingLiveDeliveriesOutcome =
  | { kind: "active" }
  | { kind: "noop" }
  | { kind: "acked"; acked: readonly string[] }
  | { kind: "requeued"; requeued: readonly string[] }

export async function processPendingLiveDeliveries(
  input: ProcessPendingLiveDeliveriesInput,
): Promise<ProcessPendingLiveDeliveriesOutcome> {
  const { client, teamRunId, memberName, sessionID, pendingInjectedMessageIds, config, idleSettleMs } = input
  if (pendingInjectedMessageIds.length === 0) {
    return { kind: "noop" }
  }

  if (typeof client.session.status === "function") {
    await settleAfterSessionIdle(idleSettleMs ?? 0)
    if (await isSessionActive(client, sessionID)) {
      log("team idle pending ack skipped while session remains active", {
        event: "team-mode-idle-pending-ack-active",
        teamRunId,
        memberName,
        sessionID,
        pendingCount: pendingInjectedMessageIds.length,
      })
      return { kind: "active" }
    }
  }

  const claimedMessageIds = await claimPendingMessageAcks(teamRunId, memberName, pendingInjectedMessageIds, config)
  if (claimedMessageIds.length === 0) {
    return { kind: "noop" }
  }

  const producedOutput = await assistantTurnProducedOutput(client, sessionID)
  if (!producedOutput) {
    await requeueLiveDeliveriesForEmptyTurn(teamRunId, memberName, claimedMessageIds, config)
    log("team idle detected empty assistant turn after live delivery, requeued for wake hint", {
      event: "team-mode-idle-empty-turn-requeue",
      teamRunId,
      memberName,
      sessionID,
      requeuedCount: claimedMessageIds.length,
    })
    return { kind: "requeued", requeued: claimedMessageIds }
  }

  await ackMessages(teamRunId, memberName, [...claimedMessageIds], config)
  log("team idle handled pending live delivery ack", {
    event: "team-mode-idle-pending-ack",
    teamRunId,
    memberName,
    sessionID,
    ackedCount: claimedMessageIds.length,
  })
  return { kind: "acked", acked: claimedMessageIds }
}

async function claimPendingMessageAcks(
  teamRunId: string,
  memberName: string,
  messageIds: readonly string[],
  config: TeamModeConfig,
): Promise<readonly string[]> {
  if (messageIds.length === 0) return []

  let claimedMessageIds: string[] = []
  const candidateMessageIds = new Set(messageIds)
  await transitionRuntimeState(teamRunId, (currentRuntimeState) => {
    const currentMember = currentRuntimeState.members.find((member) => member.name === memberName)
    if (currentMember === undefined) {
      claimedMessageIds = []
      return currentRuntimeState
    }

    claimedMessageIds = currentMember.pendingInjectedMessageIds.filter((messageId) => candidateMessageIds.has(messageId))
    if (claimedMessageIds.length === 0) {
      return currentRuntimeState
    }

    const claimedMessageIdSet = new Set(claimedMessageIds)
    return {
      ...currentRuntimeState,
      members: currentRuntimeState.members.map((member) => (
        member.name === memberName
          ? {
            ...member,
            pendingInjectedMessageIds: member.pendingInjectedMessageIds.filter((messageId) => !claimedMessageIdSet.has(messageId)),
          }
          : member
      )),
    }
  }, config)

  return claimedMessageIds
}

async function requeueLiveDeliveriesForEmptyTurn(
  teamRunId: string,
  memberName: string,
  messageIds: readonly string[],
  config: TeamModeConfig,
): Promise<void> {
  for (const messageId of messageIds) {
    const reservation = await reserveMessageForDelivery(teamRunId, memberName, messageId, config)
    if (reservation === null) continue
    await releaseDeliveryReservation(reservation)
  }
}

async function assistantTurnProducedOutput(
  client: LiveDeliveryRecoveryClient,
  sessionID: string,
): Promise<boolean> {
  const messagesApi = client.session.messages
  if (typeof messagesApi !== "function") {
    return true
  }
  try {
    const response = await messagesApi({ path: { id: sessionID } })
    const messages = extractMessagesData(response)
    const lastAssistant = findLatestAssistantMessage(messages)
    if (lastAssistant === undefined) return true
    return assistantMessageHasOutput(lastAssistant)
  } catch (error) {
    log("team idle empty-turn detection failed; defaulting to ack", {
      event: "team-mode-idle-empty-turn-detect-failed",
      sessionID,
      error: error instanceof Error ? error.message : String(error),
    })
    return true
  }
}

function extractMessagesData(response: unknown): readonly unknown[] {
  if (isRecord(response) && Array.isArray(response.data)) return response.data
  return Array.isArray(response) ? response : []
}

function findLatestAssistantMessage(messages: readonly unknown[]): unknown | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (isAssistantMessage(message)) return message
  }
  return undefined
}

function isAssistantMessage(message: unknown): boolean {
  if (!isRecord(message)) return false
  const info = isRecord(message.info) ? message.info : message
  return info.role === "assistant"
}

function assistantMessageHasOutput(message: unknown): boolean {
  if (!isRecord(message)) return false
  const parts = Array.isArray(message.parts) ? message.parts : []
  for (const part of parts) {
    if (!isRecord(part)) continue
    if (part.type === "tool") return true
    if (part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0) return true
  }
  return false
}

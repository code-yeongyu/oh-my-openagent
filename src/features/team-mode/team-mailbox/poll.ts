import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { transitionRuntimeState, loadRuntimeState } from "../team-state-store/store"
import type { Message } from "../types"
import { listUnreadMessages } from "./inbox"

export interface InjectionResult {
  injected: boolean
  content?: string
  messageIds: string[]
  reason?: string
}

function escapeAttributeValue(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;")
}

export function buildEnvelope(message: Message): string {
  const attributes = [
    `from="${escapeAttributeValue(message.from)}"`,
    `timestamp="${escapeAttributeValue(String(message.timestamp))}"`,
    `messageId="${escapeAttributeValue(message.messageId)}"`,
    `kind="${escapeAttributeValue(message.kind)}"`,
    `correlationId="${escapeAttributeValue(message.correlationId ?? "")}"`,
  ]

  if (message.summary !== undefined) {
    attributes.push(`summary="${escapeAttributeValue(message.summary)}"`)
  }

  if (message.references !== undefined) {
    attributes.push(`references="${escapeAttributeValue(JSON.stringify(message.references))}"`)
  }

  return `<peer_message ${attributes.join(" ")}>
${message.body}
</peer_message>`
}

export async function pollAndBuildInjection(
  sessionID: string,
  memberName: string,
  teamRunId: string,
  config: TeamModeConfig,
  turnMarker: string,
): Promise<InjectionResult> {
  const runtimeState = await loadRuntimeState(teamRunId, config)
  const runtimeMember = runtimeState.members.find((member) => member.name === memberName)
  if (runtimeMember === undefined) {
    throw new Error(`runtime member not found for session ${sessionID}: ${memberName}`)
  }

  if (runtimeMember.lastInjectedTurnMarker === turnMarker) {
    return { injected: false, messageIds: [], reason: "already injected this turn" }
  }

  const unreadMessages = await listUnreadMessages(teamRunId, memberName, config)
  const messageIds: string[] = []
  const envelopes: string[] = []
  for (const unreadMessage of unreadMessages) {
    messageIds.push(unreadMessage.messageId)
    envelopes.push(buildEnvelope(unreadMessage))
  }
  const content = envelopes.join("\n")

  let alreadyRecordedThisTurn = false
  let blockedByTurnLimit = false

  await transitionRuntimeState(teamRunId, (currentRuntimeState) => ({
    ...currentRuntimeState,
    members: currentRuntimeState.members.map((member) => {
      if (member.name !== memberName) {
        return member
      }

      if (member.lastInjectedTurnMarker === turnMarker) {
        return member
      }

      if (member.lastSeenTurnMarker === turnMarker) {
        alreadyRecordedThisTurn = true
        return member
      }

      const turnsUsed = member.turnsUsed ?? 0
      if (turnsUsed >= currentRuntimeState.bounds.maxMemberTurns) {
        blockedByTurnLimit = true
        return {
          ...member,
          lastSeenTurnMarker: turnMarker,
        }
      }

      return {
        ...member,
        lastSeenTurnMarker: turnMarker,
        turnsUsed: turnsUsed + 1,
        ...(messageIds.length > 0
          ? {
              lastInjectedTurnMarker: turnMarker,
              pendingInjectedMessageIds: Array.from(new Set([...member.pendingInjectedMessageIds, ...messageIds])),
            }
          : {}),
      }
    }),
  }), config)

  if (alreadyRecordedThisTurn) {
    return { injected: false, messageIds: [], reason: "already observed this turn" }
  }

  if (blockedByTurnLimit) {
    return { injected: false, messageIds: [], reason: "max member turns reached" }
  }

  if (unreadMessages.length === 0) {
    return { injected: false, messageIds: [], reason: "no unread" }
  }

  return { injected: true, content, messageIds }
}

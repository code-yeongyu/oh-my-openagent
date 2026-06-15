import type { TeamModeConfig } from "../config"
import { loadRuntimeState, transitionRuntimeState } from "../team-state-store/store"
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
  const unreadMessages = await listUnreadMessages(teamRunId, memberName, config)
  let result: InjectionResult | undefined

  await transitionRuntimeState(teamRunId, (currentRuntimeState) => {
    const runtimeMember = currentRuntimeState.members.find((member) => member.name === memberName)
    if (runtimeMember === undefined) {
      throw new Error(`runtime member not found for session ${sessionID}: ${memberName}`)
    }

    if (runtimeMember.lastInjectedTurnMarker === turnMarker) {
      result = { injected: false, messageIds: [], reason: "already injected this turn" }
      return currentRuntimeState
    }

    const pendingMessageIds = new Set(runtimeMember.pendingInjectedMessageIds)
    const injectableMessages = unreadMessages.filter((message) => !pendingMessageIds.has(message.messageId))
    if (injectableMessages.length === 0) {
      result = pendingMessageIds.size > 0
        ? { injected: false, messageIds: [], reason: "pending ack" }
        : { injected: false, messageIds: [], reason: "no unread" }
      return currentRuntimeState
    }

    const messageIds: string[] = []
    const envelopes: string[] = []
    for (const unreadMessage of injectableMessages) {
      messageIds.push(unreadMessage.messageId)
      envelopes.push(buildEnvelope(unreadMessage))
    }
    result = { injected: true, content: envelopes.join("\n"), messageIds }

    return {
      ...currentRuntimeState,
      members: currentRuntimeState.members.map((member) => (
        member.name === memberName
          ? {
            ...member,
            lastInjectedTurnMarker: turnMarker,
            pendingInjectedMessageIds: Array.from(new Set([...member.pendingInjectedMessageIds, ...messageIds])),
          }
          : member
      )),
    }
  }, config)

  if (result === undefined) {
    throw new Error(`mailbox injection claim failed for session ${sessionID}: ${memberName}`)
  }

  return result
}

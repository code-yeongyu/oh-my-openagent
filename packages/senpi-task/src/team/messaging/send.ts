import { sendMessage } from "@oh-my-opencode/team-core/team-mailbox"

import { readMemberTaskMap } from "../member-map"
import { TEAM_LEAD_SENTINEL } from "../normalize"
import { resolveTeamRuntimeDirs } from "../storage"
import { buildTeamMessage } from "./message"
import type { MessagingEngineDeps, SendTeamMessageInput, SendTeamMessageResult } from "./types"

/**
 * Writes a message to the durable recipient inbox(es) and returns. Recipient-owned pollers perform
 * delivery later, so the send path never reserves, reads, steers, revives, or notifies. Broadcast ("*")
 * remains lead-only, and the lead sentinel is a real inbox recipient.
 */
export async function sendTeamMessage(
  input: SendTeamMessageInput,
  deps: MessagingEngineDeps,
): Promise<SendTeamMessageResult> {
  const messageOptions = {
    ...(deps.now !== undefined ? { now: deps.now } : {}),
    ...(deps.newMessageId !== undefined ? { newMessageId: deps.newMessageId } : {}),
  }
  const message = buildTeamMessage(input, messageOptions)
  const runtimeDir = resolveTeamRuntimeDirs(deps.stateDir, deps.teamRunId).runtimeDir
  const memberTaskMap = await readMemberTaskMap(runtimeDir)
  const isLead = input.from === TEAM_LEAD_SENTINEL

  const sent = await sendMessage(message, deps.teamRunId, deps.config, {
    isLead,
    activeMembers: [...deps.activeMembers],
    ...(input.to === TEAM_LEAD_SENTINEL ? { leadRecipient: TEAM_LEAD_SENTINEL } : {}),
  })

  const event = {
    type: "team_message_sent",
    payload: {
      message_id: message.messageId,
      from: message.from,
      to: message.to,
      kind: message.kind,
    },
  }
  if (deps.appendEvent !== undefined) {
    if (isLead) {
      for (const recipient of sent.deliveredTo) {
        const taskId = memberTaskMap[recipient]
        if (taskId !== undefined) deps.appendEvent(taskId, event)
      }
    } else {
      const taskId = memberTaskMap[input.from]
      if (taskId !== undefined) deps.appendEvent(taskId, event)
    }
  }

  return input.to === TEAM_LEAD_SENTINEL
    ? { kind: "to_lead", messageId: sent.messageId }
    : { kind: "to_members", messageId: sent.messageId, recipients: sent.deliveredTo }
}

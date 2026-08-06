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
  }).catch((error: unknown) => {
    // team-core does not re-export InvalidRecipientError; key on its stable name like classify-error does.
    if (error instanceof Error && error.name === "InvalidRecipientError") {
      const members = [...deps.activeMembers].sort().join(", ")
      // Keep the stable error name so the tool layer still maps this to invalid_recipient.
      throw Object.assign(
        new Error(
          `unknown or inactive team recipient: ${input.to}. Members: ${members}. Use a member name, '${TEAM_LEAD_SENTINEL}', or '*' (lead-only broadcast).`,
          { cause: error },
        ),
        { name: "InvalidRecipientError" },
      )
    }
    throw error
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

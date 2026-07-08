import { sendMessage } from "@oh-my-opencode/team-core/team-mailbox"

import { readMemberTaskMap } from "../member-map"
import { TEAM_LEAD_SENTINEL } from "../normalize"
import { resolveTeamRuntimeDirs } from "../storage"
import { deliverToLead } from "./deliver-lead"
import { deliverToMember } from "./deliver-member"
import { buildTeamMessage } from "./message"
import type { MemberDeliveryResult, MessagingEngineDeps, SendTeamMessageInput, SendTeamMessageResult } from "./types"

/**
 * The team messaging entry: writes the message to the recipient inbox(es) via team-core `sendMessage`
 * (file inbox + backpressure caps) then drives senpi-native delivery. A send addressed to the "lead"
 * sentinel bypasses the inbox entirely (the lead is the CURRENT session, which has no inbox) and routes
 * through the ParentNotifier. Broadcast ("*") is lead-only (team-core rejects non-lead broadcast). The
 * active-member roster is OUR member-task sidecar, so recipient validation uses our own spawn record.
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

  if (input.to === TEAM_LEAD_SENTINEL) {
    const lead = deliverToLead({
      message,
      parentState: deps.parentState(),
      notificationConfig: deps.notificationConfig,
      notifier: deps.leadNotifier,
    })
    return { kind: "to_lead", messageId: message.messageId, lead }
  }

  const runtimeDir = resolveTeamRuntimeDirs(deps.stateDir, deps.teamRunId).runtimeDir
  const memberTaskMap = await readMemberTaskMap(runtimeDir)
  const activeMembers = Object.keys(memberTaskMap)
  const isLead = input.from === TEAM_LEAD_SENTINEL

  const sent = await sendMessage(message, deps.teamRunId, deps.config, { isLead, activeMembers })

  const deliveries: MemberDeliveryResult[] = []
  for (const recipient of sent.deliveredTo) {
    deliveries.push(
      await deliverToMember({
        message,
        recipient,
        teamRunId: deps.teamRunId,
        config: deps.config,
        memberTaskMap,
        delivery: deps.delivery,
      }),
    )
  }
  return { kind: "to_members", messageId: message.messageId, deliveries }
}

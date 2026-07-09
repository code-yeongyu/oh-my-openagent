import type { AgentToolResult } from "@code-yeongyu/senpi"

import type { LeadDeliveryResult, SendTeamMessageResult } from "../../team"
import { toolResult } from "../control"
import { classifyMailboxError, type MailboxErrorKind } from "./classify-error"
import type { TeamToolsService } from "./types"

export type LeadDeliveryView = "wake" | "deliver_streaming" | "buffered" | "failed"
export type MemberDeliveryOutcome = "steered" | "revived" | "left_unread" | "delivery_failed"

export type TeamSendMemberView = { readonly member: string; readonly outcome: MemberDeliveryOutcome; readonly reason?: string }

export type TeamSendDetails =
  | { readonly kind: "to_lead"; readonly message_id: string; readonly delivery: LeadDeliveryView }
  | { readonly kind: "to_members"; readonly message_id: string; readonly deliveries: readonly TeamSendMemberView[] }
  | { readonly kind: MailboxErrorKind; readonly to: string; readonly reason: string }

function leadDeliveryView(lead: LeadDeliveryResult): LeadDeliveryView {
  if (lead.kind === "failed") return "failed"
  if (lead.kind === "buffered") return "buffered"
  return lead.decision
}

function memberViews(result: Extract<SendTeamMessageResult, { kind: "to_members" }>): TeamSendMemberView[] {
  return result.deliveries.map((delivery) =>
    delivery.kind === "left_unread" || delivery.kind === "delivery_failed"
      ? { member: delivery.member, outcome: delivery.kind, reason: delivery.reason }
      : { member: delivery.member, outcome: delivery.kind },
  )
}

export type TeamSendInput = { readonly to: string; readonly body: string; readonly summary?: string }

export async function runTeamSend(
  service: TeamToolsService,
  teamRunId: string,
  from: string,
  input: TeamSendInput,
): Promise<AgentToolResult<TeamSendDetails>> {
  try {
    const result = await service.sendMessage(teamRunId, {
      from,
      to: input.to,
      body: input.body,
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
    })
    if (result.kind === "to_lead") {
      const delivery = leadDeliveryView(result.lead)
      return toolResult(`Message to lead: ${delivery}.`, { kind: "to_lead", message_id: result.messageId, delivery })
    }
    const deliveries = memberViews(result)
    return toolResult(
      `Delivered to ${deliveries.length} member(s).`,
      { kind: "to_members", message_id: result.messageId, deliveries },
    )
  } catch (error) {
    const mailbox = classifyMailboxError(error)
    if (mailbox !== undefined) {
      const reason = error instanceof Error ? error.message : String(error)
      return toolResult(reason, { kind: mailbox, to: input.to, reason })
    }
    throw error
  }
}

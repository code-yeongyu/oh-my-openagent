import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { Type } from "typebox"
import type { Static } from "typebox"

import { TEAM_LEAD_SENTINEL, type LeadDeliveryResult, type SendTeamMessageResult } from "../../team"
import { toolResult } from "../control"
import { classifyMailboxError, type MailboxErrorKind } from "./classify-error"
import type { TeamToolsService } from "./types"

const MESSAGE_FIELDS = {
  to: Type.String({ description: "Recipient: a member name, 'lead', or '*' to broadcast (lead-only)." }),
  body: Type.String({ description: "Message body." }),
  summary: Type.Optional(Type.String({ description: "Optional one-line summary." })),
}

export const TeamSendMessageParams = Type.Object({
  team_run_id: Type.String({ description: "Team run id whose members you are messaging." }),
  ...MESSAGE_FIELDS,
})

export const MemberSendMessageParams = Type.Object(MESSAGE_FIELDS)

export type TeamSendMessageInput = Static<typeof TeamSendMessageParams>
export type MemberSendMessageInput = Static<typeof MemberSendMessageParams>

export type LeadDeliveryView = "wake" | "queue_silently" | "deliver_streaming" | "buffered" | "failed"
export type MemberDeliveryOutcome = "steered" | "revived" | "left_unread" | "delivery_failed"

export type TeamSendMemberView = { readonly member: string; readonly outcome: MemberDeliveryOutcome; readonly reason?: string }

export type TeamSendDetails =
  | { readonly kind: "to_lead"; readonly message_id: string; readonly delivery: LeadDeliveryView }
  | { readonly kind: "to_members"; readonly message_id: string; readonly deliveries: readonly TeamSendMemberView[] }
  | { readonly kind: MailboxErrorKind; readonly to: string; readonly reason: string }

const LEAD_DESCRIPTION = [
  "Send a message to a team member, to the lead, or broadcast to all members ('*', lead-only).",
  "A message to 'lead' wakes the current session on its next idle edge; a message to a member is steered into a running member or queued.",
].join(" ")

const MEMBER_DESCRIPTION = [
  "Send a message to another member or to the team lead. Your sender identity and team are fixed to this member session.",
  "Use this to report progress, hand off work, or ask the lead a question.",
].join(" ")

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

export function createTeamSendMessageTool(deps: { readonly service: TeamToolsService }): ToolDefinition {
  return {
    name: "team_send_message",
    label: "Team Send Message",
    description: LEAD_DESCRIPTION,
    parameters: TeamSendMessageParams,
    execute: (_toolCallId: string, params: TeamSendMessageInput) =>
      runTeamSend(deps.service, params.team_run_id, TEAM_LEAD_SENTINEL, {
        to: params.to,
        body: params.body,
        ...(params.summary !== undefined ? { summary: params.summary } : {}),
      }),
  }
}

export type MemberScopedSendDeps = {
  readonly service: TeamToolsService
  readonly teamRunId: string
  readonly from: string
}

/**
 * The ONLY team tool a member child receives (todo 24 member-messaging exception). The team spawner
 * binds `teamRunId` + `from` in this closure so a member cannot spoof another sender or reach another
 * run; the member supplies only `to`/`body`/`summary`. Named `team_send_message` so it is filtered
 * out of the shared parent-tool set and re-added solely through the child's memberScopedTools.
 */
export function createMemberScopedSendMessageTool(deps: MemberScopedSendDeps): ToolDefinition {
  return {
    name: "team_send_message",
    label: "Team Send Message",
    description: MEMBER_DESCRIPTION,
    parameters: MemberSendMessageParams,
    execute: (_toolCallId: string, params: MemberSendMessageInput) =>
      runTeamSend(deps.service, deps.teamRunId, deps.from, {
        to: params.to,
        body: params.body,
        ...(params.summary !== undefined ? { summary: params.summary } : {}),
      }),
  }
}

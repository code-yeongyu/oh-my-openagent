import type { AgentToolResult } from "@code-yeongyu/senpi"

import { toolResult } from "../control"
import { classifyMailboxError, type MailboxErrorKind } from "./classify-error"
import type { TeamToolsService } from "./types"

export type LeadDeliveryView = "enqueued"
export type MemberDeliveryOutcome = "enqueued"
export type TeamSendMemberView = { readonly member: string; readonly outcome: MemberDeliveryOutcome }

export type TeamSendDetails =
  | { readonly kind: "to_lead"; readonly message_id: string }
  | { readonly kind: "to_members"; readonly message_id: string; readonly recipients: readonly string[] }
  | { readonly kind: MailboxErrorKind; readonly to: string; readonly reason: string }

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
    switch (result.kind) {
      case "to_lead":
        return toolResult("Message enqueued to lead.", { kind: "to_lead", message_id: result.messageId })
      case "to_members":
        return toolResult(
          `Message enqueued to ${result.recipients.length} recipient(s).`,
          { kind: "to_members", message_id: result.messageId, recipients: result.recipients },
        )
      default:
        return assertNever(result)
    }
  } catch (error) {
    const mailbox = classifyMailboxError(error)
    if (mailbox !== undefined) {
      const reason = error instanceof Error ? error.message : String(error)
      return toolResult(reason, { kind: mailbox, to: input.to, reason })
    }
    throw error
  }
}

function assertNever(value: never): never {
  throw new Error(`unexpected team send result: ${JSON.stringify(value)}`)
}

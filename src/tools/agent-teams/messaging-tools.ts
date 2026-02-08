import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { BackgroundManager } from "../../features/background-agent"
import { buildShutdownRequestId, readInbox, sendPlainInboxMessage, sendStructuredInboxMessage } from "./inbox-store"
import { getTeamMember, listTeammates, readTeamConfigOrThrow, updateTeamConfig } from "./team-config-store"
import { validateAgentNameOrLead, validateTeamName } from "./name-validation"
import { resumeTeammateWithMessage } from "./teammate-runtime"
import {
  TeamConfig,
  TeamReadInboxInputSchema,
  TeamSendMessageInputSchema,
  TeamToolContext,
  isTeammateMember,
} from "./types"

function nowIso(): string {
  return new Date().toISOString()
}

function resolveSenderFromContext(config: TeamConfig, context: TeamToolContext): string | null {
  if (context.sessionID === config.leadSessionId) {
    return "team-lead"
  }

  const matchedMember = config.members.find((member) => isTeammateMember(member) && member.sessionID === context.sessionID)
  return matchedMember?.name ?? null
}

function claimLeadSession(teamName: string, nextLeadSessionId: string): TeamConfig {
  return updateTeamConfig(teamName, (current) => ({
    ...current,
    leadSessionId: nextLeadSessionId,
  }))
}

export function createSendMessageTool(manager: BackgroundManager): ToolDefinition {
  return tool({
    description: "Send direct or broadcast team messages and protocol responses.",
    args: {
      team_name: tool.schema.string().describe("Team name"),
      type: tool.schema.enum(["message", "broadcast", "shutdown_request", "shutdown_response", "plan_approval_response"]),
      recipient: tool.schema.string().optional().describe("Message recipient"),
      content: tool.schema.string().optional().describe("Message body"),
      summary: tool.schema.string().optional().describe("Short summary"),
      request_id: tool.schema.string().optional().describe("Protocol request id"),
      approve: tool.schema.boolean().optional().describe("Approval flag"),
      sender: tool.schema.string().optional().describe("Sender name (default: team-lead)"),
    },
    execute: async (args: Record<string, unknown>, context: TeamToolContext): Promise<string> => {
      try {
        const input = TeamSendMessageInputSchema.parse(args)
        const teamError = validateTeamName(input.team_name)
        if (teamError) {
          return JSON.stringify({ error: teamError })
        }
        const requestedSender = input.sender
        const senderError = requestedSender ? validateAgentNameOrLead(requestedSender) : null
        if (senderError) {
          return JSON.stringify({ error: senderError })
        }
        let config = readTeamConfigOrThrow(input.team_name)
        let actor = resolveSenderFromContext(config, context)
        if (!actor && requestedSender === "team-lead") {
          config = claimLeadSession(input.team_name, context.sessionID)
          actor = "team-lead"
        }
        if (!actor) {
          return JSON.stringify({ error: "unauthorized_sender_session" })
        }
        if (requestedSender && requestedSender !== actor) {
          return JSON.stringify({ error: "sender_context_mismatch" })
        }
        const sender = requestedSender ?? actor

        const memberNames = new Set(config.members.map((member) => member.name))
        if (sender !== "team-lead" && !memberNames.has(sender)) {
          return JSON.stringify({ error: "invalid_sender" })
        }

        if (input.type === "message") {
          if (!input.recipient || !input.summary || !input.content) {
            return JSON.stringify({ error: "message_requires_recipient_summary_content" })
          }
          if (!memberNames.has(input.recipient)) {
            return JSON.stringify({ error: "message_recipient_not_found" })
          }

          const targetMember = getTeamMember(config, input.recipient)
          const color = targetMember && isTeammateMember(targetMember) ? targetMember.color : undefined
          sendPlainInboxMessage(input.team_name, sender, input.recipient, input.content, input.summary, color)

          if (targetMember && isTeammateMember(targetMember)) {
            await resumeTeammateWithMessage(manager, context, input.team_name, targetMember, input.summary, input.content)
          }

          return JSON.stringify({ success: true, message: `message_sent:${input.recipient}` })
        }

        if (input.type === "broadcast") {
          if (!input.summary) {
            return JSON.stringify({ error: "broadcast_requires_summary" })
          }
          const teammates = listTeammates(config)
          for (const teammate of teammates) {
            sendPlainInboxMessage(input.team_name, sender, teammate.name, input.content ?? "", input.summary)
            await resumeTeammateWithMessage(manager, context, input.team_name, teammate, input.summary, input.content ?? "")
          }
          return JSON.stringify({ success: true, message: `broadcast_sent:${teammates.length}` })
        }

        if (input.type === "shutdown_request") {
          if (!input.recipient) {
            return JSON.stringify({ error: "shutdown_request_requires_recipient" })
          }
          if (input.recipient === "team-lead") {
            return JSON.stringify({ error: "cannot_shutdown_team_lead" })
          }
          const targetMember = getTeamMember(config, input.recipient)
          if (!targetMember || !isTeammateMember(targetMember)) {
            return JSON.stringify({ error: "shutdown_recipient_not_found" })
          }

          const requestId = buildShutdownRequestId(input.recipient)
          sendStructuredInboxMessage(
            input.team_name,
            sender,
            input.recipient,
            {
              type: "shutdown_request",
              requestId,
              from: sender,
              reason: input.content ?? "",
              timestamp: nowIso(),
            },
            "shutdown_request",
          )

          await resumeTeammateWithMessage(
            manager,
            context,
            input.team_name,
            targetMember,
            "shutdown_request",
            input.content ?? "Shutdown requested",
          )

          return JSON.stringify({ success: true, request_id: requestId, target: input.recipient })
        }

        if (input.type === "shutdown_response") {
          if (!input.request_id) {
            return JSON.stringify({ error: "shutdown_response_requires_request_id" })
          }
          if (input.approve) {
            sendStructuredInboxMessage(
              input.team_name,
              sender,
              "team-lead",
              {
                type: "shutdown_approved",
                requestId: input.request_id,
                from: sender,
                timestamp: nowIso(),
                backendType: "native",
              },
              "shutdown_approved",
            )
            return JSON.stringify({ success: true, message: `shutdown_approved:${input.request_id}` })
          }

          sendPlainInboxMessage(
            input.team_name,
            sender,
            "team-lead",
            input.content ?? "Shutdown rejected",
            "shutdown_rejected",
          )
          return JSON.stringify({ success: true, message: `shutdown_rejected:${input.request_id}` })
        }

        if (!input.recipient) {
          return JSON.stringify({ error: "plan_response_requires_recipient" })
        }
        if (!memberNames.has(input.recipient)) {
          return JSON.stringify({ error: "plan_response_recipient_not_found" })
        }

        if (input.approve) {
          sendStructuredInboxMessage(
            input.team_name,
            sender,
            input.recipient,
            {
              type: "plan_approval",
              approved: true,
              requestId: input.request_id,
            },
            "plan_approved",
          )
          return JSON.stringify({ success: true, message: `plan_approved:${input.recipient}` })
        }

        sendPlainInboxMessage(
          input.team_name,
          sender,
          input.recipient,
          input.content ?? "Plan rejected",
          "plan_rejected",
        )
        return JSON.stringify({ success: true, message: `plan_rejected:${input.recipient}` })
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : "send_message_failed" })
      }
    },
  })
}

export function createReadInboxTool(): ToolDefinition {
  return tool({
    description: "Read inbox messages for a team member.",
    args: {
      team_name: tool.schema.string().describe("Team name"),
      agent_name: tool.schema.string().describe("Member name"),
      unread_only: tool.schema.boolean().optional().describe("Return only unread messages"),
      mark_as_read: tool.schema.boolean().optional().describe("Mark returned messages as read"),
    },
    execute: async (args: Record<string, unknown>, context: TeamToolContext): Promise<string> => {
      try {
        const input = TeamReadInboxInputSchema.parse(args)
        const teamError = validateTeamName(input.team_name)
        if (teamError) {
          return JSON.stringify({ error: teamError })
        }
        const agentError = validateAgentNameOrLead(input.agent_name)
        if (agentError) {
          return JSON.stringify({ error: agentError })
        }
        let config = readTeamConfigOrThrow(input.team_name)
        let actor = resolveSenderFromContext(config, context)
        if (!actor && input.agent_name === "team-lead") {
          config = claimLeadSession(input.team_name, context.sessionID)
          actor = "team-lead"
        }
        if (!actor) {
          return JSON.stringify({ error: "unauthorized_reader_session" })
        }

        if (actor !== "team-lead" && actor !== input.agent_name) {
          return JSON.stringify({ error: "unauthorized_reader_session" })
        }

        const messages = readInbox(
          input.team_name,
          input.agent_name,
          input.unread_only ?? false,
          input.mark_as_read ?? true,
        )
        return JSON.stringify(messages)
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : "read_inbox_failed" })
      }
    },
  })
}

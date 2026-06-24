import { randomUUID } from "node:crypto"

import { type ToolDefinition, tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { log } from "../../../shared/logger"
import { BroadcastNotPermittedError, sendMessage } from "@oh-my-opencode/team-core/team-mailbox/send"
import { MessageSchema } from "@oh-my-opencode/team-core/types"
import { deliverLive, type LiveDeliveryClient } from "./messaging-live-delivery"
import {
  defaultTeamSendMessageToolDeps,
  resolveTeamRuntimeDetails,
  shouldReserveRecipientMailbox,
  type TeamSendMessageToolDeps,
} from "./messaging-runtime"

const MESSAGE_TOOL_KINDS = ["message", "announcement"] as const

export type { LiveDeliveryClient } from "./messaging-live-delivery"
export type { TeamSendMessageToolDeps } from "./messaging-runtime"

const TeamReferenceArgsSchema = z.object({
  path: z.string().min(1),
  description: z.string().optional(),
})

const TeamSendMessageArgsSchema = z.object({
  teamRunId: z.string().min(1),
  to: z.string().min(1),
  body: z.string(),
  kind: z.enum(MESSAGE_TOOL_KINDS).optional(),
  correlationId: z.preprocess((value) => value === "" ? undefined : value, z.uuid().optional()),
  summary: z.string().optional(),
  references: z.array(TeamReferenceArgsSchema).optional(),
})

export function createTeamSendMessageTool(
  config: TeamModeConfig,
  client: LiveDeliveryClient,
  deps: TeamSendMessageToolDeps = defaultTeamSendMessageToolDeps,
): ToolDefinition {
  return tool({
    description: "Send a message to a team member or broadcast to the team.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID"),
      to: tool.schema.string().describe("Recipient name or * for broadcast"),
      body: tool.schema.string().describe("Message body"),
      kind: tool.schema.enum(MESSAGE_TOOL_KINDS).optional().default("message").describe("Message kind"),
      correlationId: tool.schema.string().optional().describe("Optional UUID correlation ID. Do not use task IDs like 'task-1'."),
      summary: tool.schema.string().optional().describe("Optional summary"),
      references: tool.schema.array(tool.schema.object({
        path: tool.schema.string(),
        description: tool.schema.string().optional(),
      })).optional().describe("Optional references as [{ path, description? }]"),
    },
    execute: async (rawArgs, context) => {
      const args = TeamSendMessageArgsSchema.parse(rawArgs)
      const runtimeContext = context as { sessionID?: string; directory?: string }
      const sessionID = runtimeContext.sessionID

      if (!sessionID) {
        throw new Error("session ID is required")
      }

      const targetDirectory = typeof runtimeContext.directory === "string" ? runtimeContext.directory : process.cwd()

      const teamRuntime = await resolveTeamRuntimeDetails(args.teamRunId, sessionID, config, deps)
      const message = MessageSchema.parse({
        version: 1,
        messageId: randomUUID(),
        from: teamRuntime.senderName,
        to: args.to,
        body: args.body,
        kind: args.kind ?? "message",
        timestamp: Date.now(),
        correlationId: args.correlationId,
        summary: args.summary,
        references: args.references,
      })

      if (message.kind === "shutdown_request" || message.kind === "shutdown_approved" || message.kind === "shutdown_rejected") {
        throw new Error("must use lifecycle tools for shutdown kinds")
      }

      if (message.to === "*" && !teamRuntime.isLead) {
        throw new BroadcastNotPermittedError()
      }

      const runtimeState = await deps.loadRuntimeState(teamRuntime.teamRunId, config)
      const reservedRecipients = new Set<string>(
        runtimeState.members
          .filter((member) => shouldReserveRecipientMailbox(member, message, teamRuntime.senderName))
          .map((member) => member.name),
      )

      const result = await sendMessage(message, teamRuntime.teamRunId, config, {
        isLead: teamRuntime.isLead,
        activeMembers: teamRuntime.activeMembers,
        reservedRecipients,
      })

      try {
        await deliverLive(client, message, teamRuntime.teamRunId, result.deliveredTo, config, targetDirectory, deps)
      } catch (liveError) {
        log("[team-mailbox] deliverLive top-level error (message already in inbox, safe to ignore)", {
          error: liveError instanceof Error ? liveError.message : String(liveError),
          teamRunId: teamRuntime.teamRunId,
          messageId: message.messageId,
        })
      }

      return JSON.stringify(result)
    },
  })
}

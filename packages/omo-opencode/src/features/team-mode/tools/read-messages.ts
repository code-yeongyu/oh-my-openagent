import { type ToolDefinition, tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { ackMessages } from "@oh-my-opencode/team-core/team-mailbox/ack"
import { listUnreadMessages } from "@oh-my-opencode/team-core/team-mailbox/inbox"
import type { Message } from "@oh-my-opencode/team-core/types"
import {
  defaultTeamSendMessageToolDeps,
  resolveTeamRuntimeDetails,
  type TeamSendMessageToolDeps,
} from "./messaging-runtime"

export type TeamReadMessagesToolDeps = TeamSendMessageToolDeps & {
  listUnreadMessages: typeof listUnreadMessages
  ackMessages: typeof ackMessages
}

export const defaultTeamReadMessagesToolDeps: TeamReadMessagesToolDeps = {
  ...defaultTeamSendMessageToolDeps,
  listUnreadMessages,
  ackMessages,
}

const TeamReadMessagesArgsSchema = z.object({
  teamRunId: z.string().min(1),
  sinceId: z.preprocess((value) => (value === "" ? undefined : value), z.string().optional()),
  mark_read: z.boolean().optional(),
})

function filterMessagesAfterId(messages: Message[], sinceId: string | undefined): Message[] {
  if (sinceId === undefined) {
    return messages
  }

  const sinceIndex = messages.findIndex((message) => message.messageId === sinceId)
  if (sinceIndex === -1) {
    return messages
  }

  return messages.slice(sinceIndex + 1)
}

export function createTeamReadMessagesTool(
  config: TeamModeConfig,
  deps: TeamReadMessagesToolDeps = defaultTeamReadMessagesToolDeps,
): ToolDefinition {
  return tool({
    description:
      "Read the bodies of inbound team messages addressed to you (the caller), oldest first. " +
      "The lead uses this to drain its own inbox on demand — team_status only exposes unread COUNTS, not content. " +
      "By default the returned messages are marked read (so they are not re-injected); pass mark_read:false to peek without consuming. " +
      "Pass sinceId to return only messages after a given messageId.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID"),
      sinceId: tool.schema.string().optional().describe("Return only messages after this messageId (exclusive). Omit to read all unread."),
      mark_read: tool.schema.boolean().optional().default(true).describe("Mark the returned messages as read so they are not re-delivered/injected. Default true; pass false to peek."),
    },
    execute: async (rawArgs, context) => {
      const args = TeamReadMessagesArgsSchema.parse(rawArgs)
      const runtimeContext = context as { sessionID?: string }
      const sessionID = runtimeContext.sessionID
      if (!sessionID) {
        throw new Error("session ID is required")
      }

      const teamRuntime = await resolveTeamRuntimeDetails(args.teamRunId, sessionID, config, deps)
      const memberName = teamRuntime.senderName

      const unread = await deps.listUnreadMessages(teamRuntime.teamRunId, memberName, config)
      const selected = filterMessagesAfterId(unread, args.sinceId)

      const markRead = args.mark_read ?? true
      if (markRead && selected.length > 0) {
        await deps.ackMessages(
          teamRuntime.teamRunId,
          memberName,
          selected.map((message) => message.messageId),
          config,
        )
      }

      return JSON.stringify({
        teamRunId: teamRuntime.teamRunId,
        member: memberName,
        count: selected.length,
        markedRead: markRead,
        messages: selected.map((message) => ({
          messageId: message.messageId,
          from: message.from,
          to: message.to,
          kind: message.kind,
          timestamp: message.timestamp,
          summary: message.summary,
          body: message.body,
          correlationId: message.correlationId,
          references: message.references,
        })),
      })
    },
  })
}

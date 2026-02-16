import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { readInbox } from "./inbox-store"
import { resolveSenderFromContext } from "./message-tool-context"
import { readTeamConfigOrThrow } from "./team-config-store"
import { validateAgentNameOrLead, validateTeamName } from "./name-validation"
import { TeamReadInboxInputSchema, TeamToolContext } from "./types"

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
        const config = readTeamConfigOrThrow(input.team_name)
        const actor = resolveSenderFromContext(config, context)
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

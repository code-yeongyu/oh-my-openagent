import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { getTeamConfigPath } from "./paths"
import { validateTeamName } from "./name-validation"
import { ensureInbox } from "./inbox-store"
import {
  TeamCreateInputSchema,
  TeamDeleteInputSchema,
  TeamReadConfigInputSchema,
  TeamToolContext,
} from "./types"
import { createTeamConfig, deleteTeamData, listTeammates, readTeamConfig, readTeamConfigOrThrow } from "./team-config-store"

export function createTeamCreateTool(): ToolDefinition {
  return tool({
    description: "Create a team workspace with config, inboxes, and task storage.",
    args: {
      team_name: tool.schema.string().describe("Team name (letters, numbers, hyphens, underscores)"),
      description: tool.schema.string().optional().describe("Team description"),
    },
    execute: async (args: Record<string, unknown>, context: TeamToolContext): Promise<string> => {
      try {
        const input = TeamCreateInputSchema.parse(args)
        const nameError = validateTeamName(input.team_name)
        if (nameError) {
          return JSON.stringify({ error: nameError })
        }

        const config = createTeamConfig(
          input.team_name,
          input.description ?? "",
          context.sessionID,
          process.cwd(),
          context.agent ?? "native",
        )
        ensureInbox(config.name, "team-lead")

        return JSON.stringify({
          team_name: config.name,
          team_file_path: getTeamConfigPath(config.name),
          lead_agent_id: config.leadAgentId,
        })
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : "team_create_failed" })
      }
    },
  })
}

export function createTeamDeleteTool(): ToolDefinition {
  return tool({
    description: "Delete a team and its stored data. Fails if teammates still exist.",
    args: {
      team_name: tool.schema.string().describe("Team name"),
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
      try {
        const input = TeamDeleteInputSchema.parse(args)
        const config = readTeamConfigOrThrow(input.team_name)
        const teammates = listTeammates(config)
        if (teammates.length > 0) {
          return JSON.stringify({
            error: "team_has_active_members",
            members: teammates.map((member) => member.name),
          })
        }

        deleteTeamData(input.team_name)
        return JSON.stringify({ success: true, team_name: input.team_name })
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : "team_delete_failed" })
      }
    },
  })
}

export function createTeamReadConfigTool(): ToolDefinition {
  return tool({
    description: "Read team configuration and member list.",
    args: {
      team_name: tool.schema.string().describe("Team name"),
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
      try {
        const input = TeamReadConfigInputSchema.parse(args)
        const config = readTeamConfig(input.team_name)
        if (!config) {
          return JSON.stringify({ error: "team_not_found" })
        }
        return JSON.stringify(config)
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : "team_read_config_failed" })
      }
    },
  })
}

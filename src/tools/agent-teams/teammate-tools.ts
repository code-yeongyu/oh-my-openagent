import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { PluginInput } from "@opencode-ai/plugin"
import type { CategoriesConfig } from "../../config/schema"
import type { BackgroundManager } from "../../features/background-agent"
import { clearInbox } from "./inbox-store"
import { validateAgentName, validateTeamName } from "./name-validation"
import {
  TeamForceKillInputSchema,
  TeamProcessShutdownInputSchema,
  TeamSpawnInputSchema,
  TeamToolContext,
  isTeammateMember,
} from "./types"
import { getTeamMember, readTeamConfigOrThrow, removeTeammate, updateTeamConfig } from "./team-config-store"
import { cancelTeammateRun, spawnTeammate } from "./teammate-runtime"
import { resetOwnerTasks } from "./team-task-store"

export interface AgentTeamsSpawnOptions {
  client?: PluginInput["client"]
  userCategories?: CategoriesConfig
  sisyphusJuniorModel?: string
}

async function shutdownTeammateWithCleanup(
  manager: BackgroundManager,
  context: TeamToolContext,
  teamName: string,
  agentName: string,
): Promise<string | null> {
  const config = readTeamConfigOrThrow(teamName)
  if (context.sessionID !== config.leadSessionId) {
    return "unauthorized_lead_session"
  }

  const member = getTeamMember(config, agentName)
  if (!member || !isTeammateMember(member)) {
    return "teammate_not_found"
  }

  await cancelTeammateRun(manager, member)
  let removed = false

  updateTeamConfig(teamName, (current) => {
    const refreshedMember = getTeamMember(current, agentName)
    if (!refreshedMember || !isTeammateMember(refreshedMember)) {
      return current
    }
    removed = true
    return removeTeammate(current, agentName)
  })

  if (removed) {
    clearInbox(teamName, agentName)
  }

  resetOwnerTasks(teamName, agentName)
  return null
}

export function createSpawnTeammateTool(manager: BackgroundManager, options?: AgentTeamsSpawnOptions): ToolDefinition {
  return tool({
    description: "Spawn a teammate using native internal agent execution.",
    args: {
      team_name: tool.schema.string().describe("Team name"),
      name: tool.schema.string().describe("Teammate name"),
      prompt: tool.schema.string().describe("Initial teammate prompt"),
      category: tool.schema.string().describe("Required category for teammate metadata and routing"),
      subagent_type: tool.schema.string().optional().describe("Agent name to run (default: sisyphus-junior)"),
      model: tool.schema.string().optional().describe("Optional model override in provider/model format"),
      plan_mode_required: tool.schema.boolean().optional().describe("Enable plan mode flag in teammate metadata"),
    },
    execute: async (args: Record<string, unknown>, context: TeamToolContext): Promise<string> => {
      try {
        const input = TeamSpawnInputSchema.parse(args)
        const teamError = validateTeamName(input.team_name)
        if (teamError) {
          return JSON.stringify({ error: teamError })
        }

        const agentError = validateAgentName(input.name)
        if (agentError) {
          return JSON.stringify({ error: agentError })
        }

        if (!input.category.trim()) {
          return JSON.stringify({ error: "category_required" })
        }

        if (input.subagent_type && input.subagent_type !== "sisyphus-junior") {
          return JSON.stringify({ error: "category_conflicts_with_subagent_type" })
        }

        const config = readTeamConfigOrThrow(input.team_name)
        if (context.sessionID !== config.leadSessionId) {
          return JSON.stringify({ error: "unauthorized_lead_session" })
        }

        const resolvedSubagentType = input.subagent_type ?? "sisyphus-junior"

        const teammate = await spawnTeammate({
          teamName: input.team_name,
          name: input.name,
          prompt: input.prompt,
          category: input.category,
          subagentType: resolvedSubagentType,
          model: input.model,
          planModeRequired: input.plan_mode_required ?? false,
          context,
          manager,
          categoryContext: options?.client
            ? {
                client: options.client,
                userCategories: options.userCategories,
                sisyphusJuniorModel: options.sisyphusJuniorModel,
              }
            : undefined,
        })

        return JSON.stringify({
          agent_id: teammate.agentId,
          name: teammate.name,
          team_name: input.team_name,
          session_id: teammate.sessionID,
          task_id: teammate.backgroundTaskID,
        })
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : "spawn_teammate_failed" })
      }
    },
  })
}

export function createForceKillTeammateTool(manager: BackgroundManager): ToolDefinition {
  return tool({
    description: "Force stop a teammate and clean up ownership state.",
    args: {
      team_name: tool.schema.string().describe("Team name"),
      agent_name: tool.schema.string().describe("Teammate name"),
    },
    execute: async (args: Record<string, unknown>, context: TeamToolContext): Promise<string> => {
      try {
        const input = TeamForceKillInputSchema.parse(args)
        const teamError = validateTeamName(input.team_name)
        if (teamError) {
          return JSON.stringify({ error: teamError })
        }
        const agentError = validateAgentName(input.agent_name)
        if (agentError) {
          return JSON.stringify({ error: agentError })
        }

        const shutdownError = await shutdownTeammateWithCleanup(manager, context, input.team_name, input.agent_name)
        if (shutdownError) {
          return JSON.stringify({ error: shutdownError })
        }

        return JSON.stringify({ success: true, message: `${input.agent_name} stopped` })
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : "force_kill_teammate_failed" })
      }
    },
  })
}

export function createProcessShutdownTool(manager: BackgroundManager): ToolDefinition {
  return tool({
    description: "Finalize an approved shutdown by removing teammate and resetting owned tasks.",
    args: {
      team_name: tool.schema.string().describe("Team name"),
      agent_name: tool.schema.string().describe("Teammate name"),
    },
    execute: async (args: Record<string, unknown>, context: TeamToolContext): Promise<string> => {
      try {
        const input = TeamProcessShutdownInputSchema.parse(args)
        const teamError = validateTeamName(input.team_name)
        if (teamError) {
          return JSON.stringify({ error: teamError })
        }
        if (input.agent_name === "team-lead") {
          return JSON.stringify({ error: "cannot_shutdown_team_lead" })
        }
        const agentError = validateAgentName(input.agent_name)
        if (agentError) {
          return JSON.stringify({ error: agentError })
        }

        const shutdownError = await shutdownTeammateWithCleanup(manager, context, input.team_name, input.agent_name)
        if (shutdownError) {
          return JSON.stringify({ error: shutdownError })
        }

        return JSON.stringify({ success: true, message: `${input.agent_name} removed` })
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : "process_shutdown_failed" })
      }
    },
  })
}

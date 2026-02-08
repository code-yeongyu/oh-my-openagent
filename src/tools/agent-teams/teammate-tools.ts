import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
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

export function createSpawnTeammateTool(manager: BackgroundManager): ToolDefinition {
  return tool({
    description: "Spawn a teammate using native internal agent execution.",
    args: {
      team_name: tool.schema.string().describe("Team name"),
      name: tool.schema.string().describe("Teammate name"),
      prompt: tool.schema.string().describe("Initial teammate prompt"),
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

        const teammate = await spawnTeammate({
          teamName: input.team_name,
          name: input.name,
          prompt: input.prompt,
          subagentType: input.subagent_type ?? "sisyphus-junior",
          model: input.model,
          planModeRequired: input.plan_mode_required ?? false,
          context,
          manager,
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
    execute: async (args: Record<string, unknown>): Promise<string> => {
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
        const config = readTeamConfigOrThrow(input.team_name)
        const member = getTeamMember(config, input.agent_name)
        if (!member || !isTeammateMember(member)) {
          return JSON.stringify({ error: "teammate_not_found" })
        }

        await cancelTeammateRun(manager, member)
        let removed = false
        updateTeamConfig(input.team_name, (current) => {
          const refreshedMember = getTeamMember(current, input.agent_name)
          if (!refreshedMember || !isTeammateMember(refreshedMember)) {
            return current
          }
          removed = true
          return removeTeammate(current, input.agent_name)
        })

        if (removed) {
          clearInbox(input.team_name, input.agent_name)
        }

        resetOwnerTasks(input.team_name, input.agent_name)

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
    execute: async (args: Record<string, unknown>): Promise<string> => {
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

        const config = readTeamConfigOrThrow(input.team_name)
        const member = getTeamMember(config, input.agent_name)
        if (!member || !isTeammateMember(member)) {
          return JSON.stringify({ error: "teammate_not_found" })
        }

        await cancelTeammateRun(manager, member)
        let removed = false

        updateTeamConfig(input.team_name, (current) => {
          const refreshedMember = getTeamMember(current, input.agent_name)
          if (!refreshedMember || !isTeammateMember(refreshedMember)) {
            return current
          }
          removed = true
          return removeTeammate(current, input.agent_name)
        })

        if (removed) {
          clearInbox(input.team_name, input.agent_name)
        }

        resetOwnerTasks(input.team_name, input.agent_name)

        return JSON.stringify({ success: true, message: `${input.agent_name} removed` })
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : "process_shutdown_failed" })
      }
    },
  })
}

import type { ToolDefinition } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../config"
import type { Managers } from "../create-managers"
import type { PluginContext } from "./types"
import type { ToolRegistryFactories } from "./tool-registry-factories"

export function getSisyphusJuniorModelOverride(agentOverride?: { model?: string }): string | undefined {
  return agentOverride?.model
}

export function createTeamModeToolsRecord(args: {
  readonly pluginConfig: OhMyOpenCodeConfig
  readonly ctx: PluginContext
  readonly managers: Pick<Managers, "backgroundManager" | "tmuxSessionManager">
  readonly factories: ToolRegistryFactories
}): Record<string, ToolDefinition> {
  const { pluginConfig, ctx, managers, factories } = args
  if (!pluginConfig.team_mode?.enabled) return {}

  return {
    team_create: factories.createTeamCreateTool(
      pluginConfig.team_mode,
      ctx.client,
      managers.backgroundManager,
      managers.tmuxSessionManager,
      {
        userCategories: pluginConfig.categories,
        sisyphusJuniorModel: getSisyphusJuniorModelOverride(pluginConfig.agents?.["sisyphus-junior"]),
        agentOverrides: pluginConfig.agents,
      },
    ),
    team_delete: factories.createTeamDeleteTool(
      pluginConfig.team_mode,
      ctx.client,
      managers.backgroundManager,
      managers.tmuxSessionManager,
    ),
    team_shutdown_request: factories.createTeamShutdownRequestTool(pluginConfig.team_mode, ctx.client),
    team_approve_shutdown: factories.createTeamApproveShutdownTool(pluginConfig.team_mode, ctx.client),
    team_reject_shutdown: factories.createTeamRejectShutdownTool(pluginConfig.team_mode, ctx.client),
    team_send_message: factories.createTeamSendMessageTool(pluginConfig.team_mode, ctx.client),
    team_read_messages: factories.createTeamReadMessagesTool(pluginConfig.team_mode),
    team_task_create: factories.createTeamTaskCreateTool(pluginConfig.team_mode, ctx.client),
    team_task_list: factories.createTeamTaskListTool(pluginConfig.team_mode, ctx.client),
    team_task_update: factories.createTeamTaskUpdateTool(pluginConfig.team_mode, ctx.client),
    team_task_get: factories.createTeamTaskGetTool(pluginConfig.team_mode, ctx.client),
    team_status: factories.createTeamStatusTool(pluginConfig.team_mode, ctx.client, managers.backgroundManager),
    team_list: factories.createTeamListTool(pluginConfig.team_mode, ctx.client),
  }
}

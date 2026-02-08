import type { ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import type { PluginInput } from "@opencode-ai/plugin"
import type { CategoriesConfig } from "../../config/schema"
import { createReadInboxTool, createSendMessageTool } from "./messaging-tools"
import { createTeamCreateTool, createTeamDeleteTool, createTeamReadConfigTool } from "./team-lifecycle-tools"
import { createTeamTaskCreateTool, createTeamTaskGetTool, createTeamTaskListTool } from "./team-task-tools"
import { createTeamTaskUpdateTool } from "./team-task-update-tool"
import { createForceKillTeammateTool, createProcessShutdownTool, createSpawnTeammateTool } from "./teammate-tools"

export interface AgentTeamsToolOptions {
  client?: PluginInput["client"]
  userCategories?: CategoriesConfig
  sisyphusJuniorModel?: string
}

export function createAgentTeamsTools(
  manager: BackgroundManager,
  options?: AgentTeamsToolOptions,
): Record<string, ToolDefinition> {
  return {
    team_create: createTeamCreateTool(),
    team_delete: createTeamDeleteTool(),
    spawn_teammate: createSpawnTeammateTool(manager, {
      client: options?.client,
      userCategories: options?.userCategories,
      sisyphusJuniorModel: options?.sisyphusJuniorModel,
    }),
    send_message: createSendMessageTool(manager),
    read_inbox: createReadInboxTool(),
    read_config: createTeamReadConfigTool(),
    team_task_create: createTeamTaskCreateTool(),
    team_task_update: createTeamTaskUpdateTool(),
    team_task_list: createTeamTaskListTool(),
    team_task_get: createTeamTaskGetTool(),
    force_kill_teammate: createForceKillTeammateTool(manager),
    process_shutdown_approved: createProcessShutdownTool(manager),
  }
}

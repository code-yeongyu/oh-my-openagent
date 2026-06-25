import type { ToolDefinition } from "@opencode-ai/plugin"

import type {
  AvailableCategory,
} from "../agents/dynamic-agent-prompt-builder"
import type { MatrixxConfig } from "../config"
import type { Managers } from "../create-managers"
import { getMainSessionID } from "../features/claude-code-session-state"
import { log } from "../shared"
import { filterDisabledTools } from "../shared/disabled-tools"
import {
  builtinTools,
  createAstGrepTools,
  createBackgroundTools,
  createDelegateAgent,
  createDelegateTask,
  createGlobTools,
  createGrepTools,
  createHandoffTools,
  createHashlineEditTool,
  createLookAt,
  createSessionManagerTools,
  createSkillMcpTool,
  createSkillTool,
  createSlashcommandTool,
  createTaskCreateTool,
  createTaskGetTool,
  createTaskList,
  createTaskUpdateTool,
  discoverCommandsSync,
  interactive_bash,
} from "../tools"
import type { SkillContext } from "./skill-context"
import type { PluginContext, ToolsRecord } from "./types"

export type ToolRegistryResult = {
  filteredTools: ToolsRecord
  taskSystemEnabled: boolean
}

export function createToolRegistry(args: {
  ctx: PluginContext
  pluginConfig: MatrixxConfig
  managers: Pick<Managers, "backgroundManager" | "tmuxSessionManager" | "skillMcpManager">
  skillContext: SkillContext
  availableCategories: AvailableCategory[]
}): ToolRegistryResult {
  const { ctx, pluginConfig, managers, skillContext, availableCategories } = args

  const backgroundTools = createBackgroundTools(managers.backgroundManager, ctx.client)
  const delegateAgent = createDelegateAgent(ctx, managers.backgroundManager, pluginConfig.disabled_agents ?? [])

  const isMultimodalLookerEnabled = !(pluginConfig.disabled_agents ?? []).some(
    (agent) => agent.toLowerCase() === "construct",
  )
  const lookAt = isMultimodalLookerEnabled ? createLookAt(ctx) : null

  const delegateTask = createDelegateTask({
    manager: managers.backgroundManager,
    client: ctx.client,
    directory: ctx.directory,
    userCategories: pluginConfig.categories,
    sisyphusJuniorModel: pluginConfig.agents?.mouse?.model,
    browserProvider: skillContext.browserProvider,
    disabledSkills: skillContext.disabledSkills,
    availableCategories,
    availableSkills: skillContext.availableSkills,
    onSyncSessionCreated: async (event) => {
      log("[index] onSyncSessionCreated callback", {
        sessionID: event.sessionID,
        parentID: event.parentID,
        title: event.title,
      })
      await managers.tmuxSessionManager.onSessionCreated({
        type: "session.created",
        properties: {
          info: {
            id: event.sessionID,
            parentID: event.parentID,
            title: event.title,
          },
        },
      })
    },
  })

  const getSessionIDForMcp = (): string => getMainSessionID() || ""

  const skillTool = createSkillTool({
    skills: skillContext.mergedSkills,
    mcpManager: managers.skillMcpManager,
    getSessionID: getSessionIDForMcp,
    disabledSkills: skillContext.disabledSkills,
  })

  const skillMcpTool = createSkillMcpTool({
    manager: managers.skillMcpManager,
    getLoadedSkills: () => skillContext.mergedSkills,
    getSessionID: getSessionIDForMcp,
  })

  const commands = discoverCommandsSync(ctx.directory)
  const slashcommandTool = createSlashcommandTool({
    commands,
    skills: skillContext.mergedSkills,
  })

  const taskSystemEnabled = pluginConfig.experimental?.task_system ?? false
  const taskToolsRecord: Record<string, ToolDefinition> = taskSystemEnabled
    ? {
        task_create: createTaskCreateTool(pluginConfig, ctx),
        task_get: createTaskGetTool(pluginConfig),
        task_list: createTaskList(pluginConfig),
        task_update: createTaskUpdateTool(pluginConfig, ctx),
      }
    : {}

  const hashlineEnabled = pluginConfig.experimental?.hashline_edit ?? false
  const hashlineToolsRecord: Record<string, ToolDefinition> = hashlineEnabled
    ? { edit: createHashlineEditTool(ctx) }
    : {}

  const allTools: Record<string, ToolDefinition> = {
    ...builtinTools,
    ...createGrepTools(ctx),
    ...createGlobTools(ctx),
    ...createAstGrepTools(ctx),
    ...createSessionManagerTools(ctx),
...createHandoffTools(ctx),
...backgroundTools,
    delegate_agent: delegateAgent,
    ...(lookAt ? { look_at: lookAt } : {}),
    task: delegateTask,
    skill: skillTool,
    skill_mcp: skillMcpTool,
    slashcommand: slashcommandTool,
    interactive_bash,
    ...taskToolsRecord,
    ...hashlineToolsRecord,
  }

  const filteredTools = filterDisabledTools(allTools, pluginConfig.disabled_tools)

  return {
    filteredTools,
    taskSystemEnabled,
  }
}

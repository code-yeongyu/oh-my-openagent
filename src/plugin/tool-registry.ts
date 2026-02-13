import type { ToolDefinition } from "@opencode-ai/plugin"

import type {
  AvailableCategory,
} from "../agents/dynamic-agent-prompt-builder"
import type { OhMyOpenCodeConfig } from "../config"
import type { PluginContext, ToolsRecord } from "./types"

import {
  builtinTools,
  createBackgroundTools,
  createCallOmoAgent,
  createLookAt,
  createSkillTool,
  createSkillMcpTool,
  createSlashcommandTool,
  createGrepTools,
  createGlobTools,
  createAstGrepTools,
  createSessionManagerTools,
  createDelegateTask,
  discoverCommandsSync,
  interactive_bash,
  createTaskCreateTool,
  createTaskGetTool,
  createTaskList,
  createTaskUpdateTool,
} from "../tools"
import { getMainSessionID } from "../features/claude-code-session-state"
import { filterDisabledTools } from "../shared/disabled-tools"
import { log } from "../shared"

import type { Managers } from "../create-managers"
import type { SkillContext } from "./skill-context"

export type ToolRegistryResult = {
  filteredTools: ToolsRecord
  taskSystemEnabled: boolean
}

export function createToolRegistry(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  managers: Pick<Managers, "backgroundManager" | "tmuxSessionManager" | "skillMcpManager">
  skillContext: SkillContext
  availableCategories: AvailableCategory[]
}): ToolRegistryResult {
  const { ctx, pluginConfig, managers, skillContext, availableCategories } = args

  const backgroundTools = createBackgroundTools(managers.backgroundManager, ctx.client)
  const callOmoAgent = createCallOmoAgent(ctx, managers.backgroundManager)

  const isMultimodalLookerEnabled = !(pluginConfig.disabled_agents ?? []).some(
    (agent) => agent.toLowerCase() === "multimodal-looker",
  )
  const lookAt = isMultimodalLookerEnabled ? createLookAt(ctx) : null

  const delegateTask = createDelegateTask({
    manager: managers.backgroundManager,
    client: ctx.client,
    directory: ctx.directory,
    userCategories: pluginConfig.categories,
    gitMasterConfig: pluginConfig.git_master,
    sisyphusJuniorModel: pluginConfig.agents?.["sisyphus-junior"]?.model,
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
    gitMasterConfig: pluginConfig.git_master,
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

  const allTools: Record<string, ToolDefinition> = {
    ...builtinTools,
    ...createGrepTools(ctx),
    ...createGlobTools(ctx),
    ...createAstGrepTools(ctx),
    ...createSessionManagerTools(ctx),
    ...backgroundTools,
    call_omo_agent: callOmoAgent,
    ...(lookAt ? { look_at: lookAt } : {}),
    task: delegateTask,
    skill: skillTool,
    skill_mcp: skillMcpTool,
    slashcommand: slashcommandTool,
    interactive_bash,
    ...taskToolsRecord,
  }

  const filteredTools = filterDisabledTools(allTools, pluginConfig.disabled_tools)

  return {
    filteredTools,
    taskSystemEnabled,
  }
}

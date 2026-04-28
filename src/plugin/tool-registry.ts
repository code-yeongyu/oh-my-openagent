import type { ToolDefinition } from "@opencode-ai/plugin"
import type { SkillLoadOptions } from "../tools/skill/types"

import type {
  AvailableCategory,
} from "../agents/dynamic-agent-prompt-builder"
import type { OhMyOpenCodeConfig } from "../config"
import { isInteractiveBashEnabled } from "../create-runtime-tmux-config"
import {
  createTeamApproveShutdownTool,
  createTeamCreateTool,
  createTeamDeleteTool,
  createTeamRejectShutdownTool,
  createTeamShutdownRequestTool,
} from "../features/team-mode/tools/lifecycle"
import { createTeamSendMessageTool } from "../features/team-mode/tools/messaging"
import { createTeamListTool, createTeamStatusTool } from "../features/team-mode/tools/query"
import {
  createTeamTaskCreateTool,
  createTeamTaskGetTool,
  createTeamTaskListTool,
  createTeamTaskUpdateTool,
} from "../features/team-mode/tools/tasks"
import * as openclawRuntimeDispatch from "../openclaw/runtime-dispatch"
import type { PluginContext, ToolsRecord } from "./types"

import {
  builtinTools,
  createBackgroundTools,
  createCallOmoAgent,
  createLookAt,
  createSkillMcpTool,
  createSkillTool,
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
  createHashlineEditTool,
} from "../tools"
import { getMainSessionID } from "../features/claude-code-session-state"
import { filterDisabledTools } from "../shared/disabled-tools"
import { isTaskSystemEnabled, log } from "../shared"

import type { Managers } from "../create-managers"
import type { SkillContext } from "./skill-context"
import { normalizeToolArgSchemas } from "./normalize-tool-arg-schemas"

type ToolRegistryFactories = {
  builtinTools: typeof builtinTools
  createBackgroundTools: typeof createBackgroundTools
  createCallOmoAgent: typeof createCallOmoAgent
  createLookAt: typeof createLookAt
  createSkillMcpTool: typeof createSkillMcpTool
  createSkillTool: typeof createSkillTool
  createGrepTools: typeof createGrepTools
  createGlobTools: typeof createGlobTools
  createAstGrepTools: typeof createAstGrepTools
  createSessionManagerTools: typeof createSessionManagerTools
  createDelegateTask: typeof createDelegateTask
  discoverCommandsSync: typeof discoverCommandsSync
  interactive_bash: typeof interactive_bash
  createTaskCreateTool: typeof createTaskCreateTool
  createTaskGetTool: typeof createTaskGetTool
  createTaskList: typeof createTaskList
  createTaskUpdateTool: typeof createTaskUpdateTool
  createHashlineEditTool: typeof createHashlineEditTool
  createTeamApproveShutdownTool: typeof createTeamApproveShutdownTool
  createTeamCreateTool: typeof createTeamCreateTool
  createTeamDeleteTool: typeof createTeamDeleteTool
  createTeamRejectShutdownTool: typeof createTeamRejectShutdownTool
  createTeamShutdownRequestTool: typeof createTeamShutdownRequestTool
  createTeamSendMessageTool: typeof createTeamSendMessageTool
  createTeamTaskCreateTool: typeof createTeamTaskCreateTool
  createTeamTaskGetTool: typeof createTeamTaskGetTool
  createTeamTaskListTool: typeof createTeamTaskListTool
  createTeamTaskUpdateTool: typeof createTeamTaskUpdateTool
  createTeamStatusTool: typeof createTeamStatusTool
  createTeamListTool: typeof createTeamListTool
}

const defaultToolRegistryFactories: ToolRegistryFactories = {
  builtinTools,
  createBackgroundTools,
  createCallOmoAgent,
  createLookAt,
  createSkillMcpTool,
  createSkillTool,
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
  createHashlineEditTool,
  createTeamApproveShutdownTool,
  createTeamCreateTool,
  createTeamDeleteTool,
  createTeamRejectShutdownTool,
  createTeamShutdownRequestTool,
  createTeamSendMessageTool,
  createTeamTaskCreateTool,
  createTeamTaskGetTool,
  createTeamTaskListTool,
  createTeamTaskUpdateTool,
  createTeamStatusTool,
  createTeamListTool,
}

export type ToolRegistryResult = {
  filteredTools: ToolsRecord
  taskSystemEnabled: boolean
}

const LOW_PRIORITY_TOOL_ORDER = [
  "session_list",
  "session_read",
  "session_search",
  "session_info",
  "interactive_bash",
  "look_at",
  "call_omo_agent",
  "task_create",
  "task_get",
  "task_list",
  "task_update",
  "background_output",
  "background_cancel",
  "edit",
  "ast_grep_replace",
  "ast_grep_search",
  "glob",
  "grep",
  "skill_mcp",
  "skill",
  "task",
  "lsp_rename",
  "lsp_prepare_rename",
  "lsp_find_references",
  "lsp_goto_definition",
  "lsp_symbols",
  "lsp_diagnostics",
] as const

export function trimToolsToCap(filteredTools: ToolsRecord, maxTools: number): void {
  const toolNames = Object.keys(filteredTools)
  if (toolNames.length <= maxTools) return

  const removableToolNames = [
    ...LOW_PRIORITY_TOOL_ORDER.filter((toolName) => toolNames.includes(toolName)),
    ...toolNames
      .filter((toolName) => !LOW_PRIORITY_TOOL_ORDER.includes(toolName as (typeof LOW_PRIORITY_TOOL_ORDER)[number]))
      .sort(),
  ]

  let currentCount = toolNames.length
  let removed = 0

  for (const toolName of removableToolNames) {
    if (currentCount <= maxTools) break
    if (!filteredTools[toolName]) continue
    delete filteredTools[toolName]
    currentCount -= 1
    removed += 1
  }

  log(
    `[tool-registry] Trimmed ${removed} tools to satisfy max_tools=${maxTools}. Final plugin tool count=${currentCount}.`,
  )
}

export function createToolRegistry(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  managers: Pick<Managers, "backgroundManager" | "tmuxSessionManager" | "skillMcpManager" | "modelFallbackControllerAccessor">
  skillContext: SkillContext
  availableCategories: AvailableCategory[]
  interactiveBashEnabled?: boolean
  toolFactories?: Partial<ToolRegistryFactories>
}): ToolRegistryResult {
  const {
    ctx,
    pluginConfig,
    managers,
    skillContext,
    availableCategories,
    interactiveBashEnabled = isInteractiveBashEnabled(),
    toolFactories,
  } = args
  const factories: ToolRegistryFactories = {
    ...defaultToolRegistryFactories,
    ...toolFactories,
  }
  const backgroundTools = factories.createBackgroundTools(managers.backgroundManager, ctx.client)
  const callOmoAgent = factories.createCallOmoAgent(
    ctx,
    managers.backgroundManager,
    pluginConfig.disabled_agents ?? [],
    pluginConfig.agents,
    pluginConfig.categories,
    managers.modelFallbackControllerAccessor,
  )

  const isMultimodalLookerEnabled = !(pluginConfig.disabled_agents ?? []).some(
    (agent) => agent.toLowerCase() === "multimodal-looker",
  )
  const lookAt = isMultimodalLookerEnabled ? factories.createLookAt(ctx) : null

  const getSisyphusJuniorModelOverride = (agentOverride?: { model?: string }): string | undefined => agentOverride?.model

  const delegateTask = factories.createDelegateTask({
    manager: managers.backgroundManager,
    client: ctx.client,
    directory: ctx.directory,
    userCategories: pluginConfig.categories,
    agentOverrides: pluginConfig.agents,
    gitMasterConfig: pluginConfig.git_master,
    sisyphusJuniorModel: getSisyphusJuniorModelOverride(pluginConfig.agents?.["sisyphus-junior"]),
    browserProvider: skillContext.browserProvider,
    disabledSkills: skillContext.disabledSkills,
    teamModeEnabled: pluginConfig.team_mode?.enabled ?? false,
    availableCategories,
    availableSkills: skillContext.availableSkills,
    sisyphusAgentConfig: pluginConfig.sisyphus_agent,
    syncPollTimeoutMs: pluginConfig.background_task?.syncPollTimeoutMs,
    modelFallbackControllerAccessor: managers.modelFallbackControllerAccessor,
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

      if (pluginConfig.openclaw) {
        await openclawRuntimeDispatch.dispatchOpenClawEvent({
          config: pluginConfig.openclaw,
          rawEvent: "session.created",
          context: {
            sessionId: event.sessionID,
            projectPath: ctx.directory,
            tmuxPaneId: managers.tmuxSessionManager.getTrackedPaneId?.(event.sessionID) ?? process.env.TMUX_PANE,
          },
        })
      }
    },
  })

  const getSessionIDForMcp = (): string | undefined => getMainSessionID()

  const skillMcpTool = factories.createSkillMcpTool({
    manager: managers.skillMcpManager,
    getLoadedSkills: () => skillContext.mergedSkills,
    getSessionID: getSessionIDForMcp,
  })

  const commands = factories.discoverCommandsSync(ctx.directory, {
    pluginsEnabled: pluginConfig.claude_code?.plugins ?? true,
    enabledPluginsOverride: pluginConfig.claude_code?.plugins_override,
  })
  const skillTool = factories.createSkillTool({
    commands,
    skills: skillContext.mergedSkills,
    mcpManager: managers.skillMcpManager,
    getSessionID: getSessionIDForMcp,
    gitMasterConfig: pluginConfig.git_master,
    browserProvider: skillContext.browserProvider,
    teamModeEnabled: pluginConfig.team_mode?.enabled ?? false,
    nativeSkills: "skills" in ctx ? (ctx as { skills: SkillLoadOptions["nativeSkills"] }).skills : undefined,
  })

  const taskSystemEnabled = isTaskSystemEnabled(pluginConfig)
  const taskToolsRecord: Record<string, ToolDefinition> = taskSystemEnabled
    ? {
        task_create: factories.createTaskCreateTool(pluginConfig, ctx),
        task_get: factories.createTaskGetTool(pluginConfig),
        task_list: factories.createTaskList(pluginConfig),
        task_update: factories.createTaskUpdateTool(pluginConfig, ctx),
      }
    : {}

  const hashlineEnabled = pluginConfig.hashline_edit ?? false
  const hashlineToolsRecord: Record<string, ToolDefinition> = hashlineEnabled
    ? { edit: factories.createHashlineEditTool(ctx) }
    : {}

  const teamModeToolsRecord: Record<string, ToolDefinition> = pluginConfig.team_mode?.enabled
    ? {
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
        team_task_create: factories.createTeamTaskCreateTool(pluginConfig.team_mode, ctx.client),
        team_task_list: factories.createTeamTaskListTool(pluginConfig.team_mode, ctx.client),
        team_task_update: factories.createTeamTaskUpdateTool(pluginConfig.team_mode, ctx.client),
        team_task_get: factories.createTeamTaskGetTool(pluginConfig.team_mode, ctx.client),
        team_status: factories.createTeamStatusTool(pluginConfig.team_mode, ctx.client, managers.backgroundManager),
        team_list: factories.createTeamListTool(pluginConfig.team_mode, ctx.client),
      }
    : {}

  const allTools: Record<string, ToolDefinition> = {
    ...factories.builtinTools,
    ...factories.createGrepTools(ctx),
    ...factories.createGlobTools(ctx),
    ...factories.createAstGrepTools(ctx),
    ...factories.createSessionManagerTools(ctx),
    ...backgroundTools,
    call_omo_agent: callOmoAgent,
    ...(lookAt ? { look_at: lookAt } : {}),
    task: delegateTask,
    skill_mcp: skillMcpTool,
    skill: skillTool,
    ...(interactiveBashEnabled ? { interactive_bash: factories.interactive_bash } : {}),
    ...teamModeToolsRecord,
    ...taskToolsRecord,
    ...hashlineToolsRecord,
  }

  for (const toolDefinition of Object.values(allTools)) {
    normalizeToolArgSchemas(toolDefinition)
  }

  const filteredTools: ToolsRecord = filterDisabledTools(allTools, pluginConfig.disabled_tools)

  const maxTools = pluginConfig.experimental?.max_tools
  if (maxTools) {
    trimToolsToCap(filteredTools, maxTools)
  }

  return {
    filteredTools,
    taskSystemEnabled,
  }
}

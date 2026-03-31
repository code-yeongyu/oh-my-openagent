import type { ToolDefinition } from "@opencode-ai/plugin"
import type { SkillLoadOptions } from "../tools/skill/types"

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
import { log } from "../shared"

import type { Managers } from "../create-managers"
import type { SkillContext } from "./skill-context"
import { normalizeToolArgSchemas } from "./normalize-tool-arg-schemas"

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
  managers: Pick<Managers, "backgroundManager" | "tmuxSessionManager" | "skillMcpManager">
  skillContext: SkillContext
  availableCategories: AvailableCategory[]
}): ToolRegistryResult {
  const { ctx, pluginConfig, managers, skillContext, availableCategories } = args

  const backgroundTools = createBackgroundTools(managers.backgroundManager, ctx.client)
  const callOmoAgent = createCallOmoAgent(
    ctx,
    managers.backgroundManager,
    pluginConfig.disabled_agents ?? [],
    pluginConfig.agents,
    pluginConfig.categories,
  )

  const isMultimodalLookerEnabled = !(pluginConfig.disabled_agents ?? []).some(
    (agent) => agent.toLowerCase() === "multimodal-looker",
  )
  const lookAt = isMultimodalLookerEnabled ? createLookAt(ctx) : null

  const delegateTask = createDelegateTask({
    manager: managers.backgroundManager,
    client: ctx.client,
    directory: ctx.directory,
    userCategories: pluginConfig.categories,
    agentOverrides: pluginConfig.agents,
    gitMasterConfig: pluginConfig.git_master,
    sisyphusJuniorModel: pluginConfig.agents?.["sisyphus-junior"]?.model,
    browserProvider: skillContext.browserProvider,
    disabledSkills: skillContext.disabledSkills,
    availableCategories,
    availableSkills: skillContext.availableSkills,
    sisyphusAgentConfig: pluginConfig.sisyphus_agent,
    syncPollTimeoutMs: pluginConfig.background_task?.syncPollTimeoutMs,
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

  const skillMcpTool = createSkillMcpTool({
    manager: managers.skillMcpManager,
    getLoadedSkills: () => skillContext.mergedSkills,
    getSessionID: getSessionIDForMcp,
  })

  const commands = discoverCommandsSync(ctx.directory, {
    pluginsEnabled: pluginConfig.claude_code?.plugins ?? true,
    enabledPluginsOverride: pluginConfig.claude_code?.plugins_override,
  })
  const skillTool = createSkillTool({
    commands,
    skills: skillContext.mergedSkills,
    mcpManager: managers.skillMcpManager,
    getSessionID: getSessionIDForMcp,
    gitMasterConfig: pluginConfig.git_master,
    browserProvider: skillContext.browserProvider,
    nativeSkills: "skills" in ctx ? (ctx as { skills: SkillLoadOptions["nativeSkills"] }).skills : undefined,
  })

  // task_system defaults to true since v3.14 — delegation (oracle, subagents) requires it
  const taskSystemEnabled = pluginConfig.experimental?.task_system ?? true
  const taskToolsRecord: Record<string, ToolDefinition> = taskSystemEnabled
    ? {
        task_create: createTaskCreateTool(pluginConfig, ctx),
        task_get: createTaskGetTool(pluginConfig),
        task_list: createTaskList(pluginConfig),
        task_update: createTaskUpdateTool(pluginConfig, ctx),
      }
    : {}

  const hashlineEnabled = pluginConfig.hashline_edit ?? false
  const hashlineToolsRecord: Record<string, ToolDefinition> = hashlineEnabled
    ? { edit: createHashlineEditTool(ctx) }
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
    skill_mcp: skillMcpTool,
    skill: skillTool,
    interactive_bash,
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

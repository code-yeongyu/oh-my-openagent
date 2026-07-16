import type { AvailableCategory } from "../agents/dynamic-agent-prompt-builder"
import type { OhMyOpenCodeConfig } from "../config"
import type { Managers } from "../create-managers"
import type { SkillContext } from "./skill-context"
import type { PluginContext, ToolsRecord } from "./types"
import type { ToolRegistryFactories } from "./tool-registry-factories"

import { isInteractiveBashEnabled } from "../interactive-bash-availability"
import { filterDisabledTools } from "../shared/disabled-tools"
import { log } from "../shared"
import { normalizeToolArgSchemas } from "./normalize-tool-arg-schemas"
import { createCoreTools } from "./tool-registry-core-tools"
import { defaultToolRegistryFactories } from "./tool-registry-factories"
import {
  createHashlineToolsRecord,
  createMonitorToolsRecord,
  createTaskToolsRecord,
  getTaskSystemEnabled,
} from "./tool-registry-gated-tools"
import { createTeamModeToolsRecord } from "./tool-registry-team-tools"
export { trimToolsToCap } from "./tool-registry-trimming"
import { trimToolsToCap } from "./tool-registry-trimming"

export type ToolRegistryResult = {
  filteredTools: ToolsRecord
  taskSystemEnabled: boolean
}

export function createToolRegistry(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  managers: Pick<Managers, "backgroundManager" | "tmuxSessionManager" | "skillMcpManager" | "modelFallbackControllerAccessor" | "monitorManager">
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
  const taskSystemEnabled = getTaskSystemEnabled(pluginConfig)
  let backgroundWaitEnabled = false
  const allTools = {
    ...createCoreTools({
      ctx,
      pluginConfig,
      managers,
      skillContext,
      availableCategories,
      factories,
      isBackgroundWaitAvailable: () => backgroundWaitEnabled,
    }),
    ...(interactiveBashEnabled ? { interactive_bash: factories.interactive_bash } : {}),
    ...createTeamModeToolsRecord({ pluginConfig, ctx, managers, factories }),
    ...createMonitorToolsRecord({ pluginConfig, ctx, managers, factories }),
    ...createTaskToolsRecord({ taskSystemEnabled, pluginConfig, ctx, factories }),
    ...createHashlineToolsRecord({ pluginConfig, ctx, factories }),
  }

  const allToolNames = Object.keys(allTools)
  const teamToolCount = allToolNames.filter((toolName) => toolName.startsWith("team_")).length
  log("[tool-registry] Built tool registry", {
    totalTools: allToolNames.length,
    teamModeEnabled: pluginConfig.team_mode?.enabled ?? false,
    teamToolCount,
  })

  for (const toolDefinition of Object.values(allTools)) {
    normalizeToolArgSchemas(toolDefinition)
  }

  const filteredTools: ToolsRecord = filterDisabledTools(allTools, pluginConfig.disabled_tools)

  const maxTools = pluginConfig.experimental?.max_tools
  if (maxTools) {
    trimToolsToCap(filteredTools, maxTools)
  }

  if (filteredTools["wait-for-background-tasks"] && !filteredTools.background_output) {
    delete filteredTools["wait-for-background-tasks"]
  }

  backgroundWaitEnabled = filteredTools["wait-for-background-tasks"] !== undefined

  return {
    filteredTools,
    taskSystemEnabled,
  }
}

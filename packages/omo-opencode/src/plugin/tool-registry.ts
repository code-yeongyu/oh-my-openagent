import type { AvailableCategory } from "../agents/dynamic-agent-prompt-builder"
import type { OhMyOpenCodeConfig } from "../config"
import type { Managers } from "../create-managers"
import type { SkillContext } from "./skill-context"
import type { PluginContext, ToolsRecord } from "./types"
import type { ToolRegistryFactories } from "./tool-registry-factories"

import { isInteractiveBashEnabled } from "../interactive-bash-availability"
import { filterDisabledTools } from "../shared/disabled-tools"
import { log } from "../shared"
import { stableStringify } from "../shared/stable-stringify"
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

const CACHE_KEY_SEPARATOR = "\0"

const frozenRegistryCache = new Map<string, ToolRegistryResult>()

export function clearToolRegistryCache(): void {
  frozenRegistryCache.clear()
}

function readRegistryGateSnapshot(args: {
  pluginConfig: OhMyOpenCodeConfig
  taskSystemEnabled: boolean
  interactiveBashEnabled: boolean
}): Record<string, unknown> {
  const { pluginConfig, taskSystemEnabled, interactiveBashEnabled } = args
  return {
    interactiveBashEnabled,
    teamModeEnabled: pluginConfig.team_mode?.enabled ?? false,
    monitorEnabled: pluginConfig.monitor?.enabled ?? false,
    taskSystemEnabled,
    maxTools: pluginConfig.experimental?.max_tools,
    disabledTools: pluginConfig.disabled_tools,
    disabledAgents: pluginConfig.disabled_agents,
    goalEnabled: pluginConfig.goal?.enabled ?? false,
    hashlineEdit: pluginConfig.hashline_edit ?? false,
  }
}

function toRegistryCacheKey(sessionID: string, snapshot: Record<string, unknown>): string {
  return [sessionID, stableStringify(snapshot)].join(CACHE_KEY_SEPARATOR)
}

function sortToolsRecord(tools: ToolsRecord): ToolsRecord {
  const sorted: ToolsRecord = {}
  for (const toolName of Object.keys(tools).sort()) {
    sorted[toolName] = tools[toolName]
  }
  return sorted
}

function normalizeSortedTools(tools: ToolsRecord): ToolsRecord {
  const sorted = sortToolsRecord(tools)
  for (const toolDefinition of Object.values(sorted)) {
    normalizeToolArgSchemas(toolDefinition)
  }
  return sorted
}

export function createToolRegistry(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  managers: Pick<Managers, "backgroundManager" | "tmuxSessionManager" | "skillMcpManager" | "modelFallbackControllerAccessor" | "monitorManager">
  skillContext: SkillContext
  availableCategories: AvailableCategory[]
  interactiveBashEnabled?: boolean
  toolFactories?: Partial<ToolRegistryFactories>
  sessionID?: string
}): ToolRegistryResult {
  const {
    ctx,
    pluginConfig,
    managers,
    skillContext,
    availableCategories,
    interactiveBashEnabled = isInteractiveBashEnabled(),
    toolFactories,
    sessionID,
  } = args
  const factories: ToolRegistryFactories = {
    ...defaultToolRegistryFactories,
    ...toolFactories,
  }
  const taskSystemEnabled = getTaskSystemEnabled(pluginConfig)
  const allTools = {
    ...createCoreTools({
      ctx,
      pluginConfig,
      managers,
      skillContext,
      availableCategories,
      factories,
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

  const filteredTools: ToolsRecord = filterDisabledTools(allTools, pluginConfig.disabled_tools)

  const maxTools = pluginConfig.experimental?.max_tools
  if (maxTools) {
    trimToolsToCap(filteredTools, maxTools)
  }

  const snapshot = readRegistryGateSnapshot({ pluginConfig, taskSystemEnabled, interactiveBashEnabled })
  if (sessionID === undefined) {
    return {
      filteredTools: normalizeSortedTools(filteredTools),
      taskSystemEnabled,
    }
  }

  const cacheKey = toRegistryCacheKey(sessionID, snapshot)
  const cached = frozenRegistryCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const result: ToolRegistryResult = {
    filteredTools: Object.freeze(normalizeSortedTools(filteredTools)),
    taskSystemEnabled,
  }
  frozenRegistryCache.set(cacheKey, result)
  return result
}

import type { ToolDefinition } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../config"
import type { Managers } from "../create-managers"
import type { PluginContext } from "./types"
import type { ToolRegistryFactories } from "./tool-registry-factories"

import { isTaskSystemEnabled } from "../shared"

export function createTaskToolsRecord(args: {
  readonly taskSystemEnabled: boolean
  readonly pluginConfig: OhMyOpenCodeConfig
  readonly ctx: PluginContext
  readonly factories: ToolRegistryFactories
}): Record<string, ToolDefinition> {
  const { taskSystemEnabled, pluginConfig, ctx, factories } = args
  if (!taskSystemEnabled) return {}

  return {
    task_create: factories.createTaskCreateTool(pluginConfig, ctx),
    task_get: factories.createTaskGetTool(pluginConfig),
    task_list: factories.createTaskList(pluginConfig),
    task_update: factories.createTaskUpdateTool(pluginConfig, ctx),
  }
}

export function createHashlineToolsRecord(args: {
  readonly pluginConfig: OhMyOpenCodeConfig
  readonly ctx: PluginContext
  readonly factories: ToolRegistryFactories
}): Record<string, ToolDefinition> {
  const { pluginConfig, ctx, factories } = args
  return pluginConfig.hashline_edit ? { edit: factories.createHashlineEditTool(ctx) } : {}
}

export function createMonitorToolsRecord(args: {
  readonly pluginConfig: OhMyOpenCodeConfig
  readonly ctx: PluginContext
  readonly managers: Pick<Managers, "monitorManager">
  readonly factories: ToolRegistryFactories
}): Record<string, ToolDefinition> {
  const { pluginConfig, ctx, managers, factories } = args
  if (!pluginConfig.monitor?.enabled || !managers.monitorManager) return {}
  return factories.createMonitorTools(managers.monitorManager, Object.assign({}, ctx, { pluginConfig }))
}

export function getTaskSystemEnabled(pluginConfig: OhMyOpenCodeConfig): boolean {
  return isTaskSystemEnabled(pluginConfig)
}

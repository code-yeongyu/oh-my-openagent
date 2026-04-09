import type { ToolDefinition } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../../config"
import type { PluginContext } from "../types"
import {
  createTaskCreateTool,
  createTaskGetTool,
  createTaskList,
  createTaskUpdateTool,
  createHashlineEditTool,
} from "../../tools"
import { isTaskSystemEnabled } from "../../shared"

export function createFeatureTools(
  ctx: PluginContext,
  pluginConfig: OhMyOpenCodeConfig,
): Record<string, ToolDefinition> {
  const taskTools: Record<string, ToolDefinition> = isTaskSystemEnabled(pluginConfig)
    ? {
        task_create: createTaskCreateTool(pluginConfig, ctx),
        task_get: createTaskGetTool(pluginConfig),
        task_list: createTaskList(pluginConfig),
        task_update: createTaskUpdateTool(pluginConfig, ctx),
      }
    : {}

  const hashlineTools: Record<string, ToolDefinition> = pluginConfig.hashline_edit
    ? { edit: createHashlineEditTool(ctx) }
    : {}

  return { ...taskTools, ...hashlineTools }
}

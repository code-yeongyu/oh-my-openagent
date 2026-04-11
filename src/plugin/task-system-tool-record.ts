import type { ToolDefinition } from "@opencode-ai/plugin"

import type { OhMyOpenCodeConfig } from "../config"
import {
  createTaskCreateTool,
  createTaskGetTool,
  createTaskList,
  createTaskUpdateTool,
} from "../tools"
import { isTaskSystemEnabled } from "../shared"

import type { PluginContext } from "./types"

export type TaskSystemToolRecordResult = {
  taskSystemEnabled: boolean
  taskToolsRecord: Record<string, ToolDefinition>
}

export function createTaskSystemToolRecord(
  pluginConfig: OhMyOpenCodeConfig,
  ctx: PluginContext,
): TaskSystemToolRecordResult {
  const taskSystemEnabled = isTaskSystemEnabled(pluginConfig)
  const taskToolsRecord: Record<string, ToolDefinition> = {}

  if (taskSystemEnabled) {
    taskToolsRecord.task_create = createTaskCreateTool(pluginConfig, ctx)
    taskToolsRecord.task_get = createTaskGetTool(pluginConfig)
    taskToolsRecord.task_list = createTaskList(pluginConfig)
    taskToolsRecord.task_update = createTaskUpdateTool(pluginConfig, ctx)
  }

  return {
    taskSystemEnabled,
    taskToolsRecord,
  }
}

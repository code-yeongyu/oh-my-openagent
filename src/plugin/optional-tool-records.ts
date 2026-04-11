import type { ToolDefinition } from "@opencode-ai/plugin"

import type { OhMyOpenCodeConfig } from "../config"
import { createHashlineEditTool, createLookAt, interactive_bash } from "../tools"

import type { PluginContext } from "./types"

export function createLookAtToolRecord(
  pluginConfig: OhMyOpenCodeConfig,
  ctx: PluginContext,
): Record<string, ToolDefinition> {
  const isMultimodalLookerEnabled = !(pluginConfig.disabled_agents ?? []).some(
    (agent) => agent.toLowerCase() === "multimodal-looker",
  )
  const lookAt = isMultimodalLookerEnabled ? createLookAt(ctx) : null

  return lookAt ? { look_at: lookAt } : {}
}

export function createInteractiveBashToolRecord(
  interactiveBashEnabled: boolean,
): Record<string, ToolDefinition> {
  return interactiveBashEnabled ? { interactive_bash } : {}
}

export function createHashlineEditToolRecord(
  pluginConfig: OhMyOpenCodeConfig,
  ctx: PluginContext,
): Record<string, ToolDefinition> {
  return pluginConfig.hashline_edit ? { edit: createHashlineEditTool(ctx) } : {}
}

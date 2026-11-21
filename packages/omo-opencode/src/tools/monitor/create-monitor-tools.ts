import type { ToolDefinition } from "@opencode-ai/plugin"

import type { MonitorManager } from "../../features/monitor"
import type { OhMyOpenCodeConfig } from "../../config"
import type { PluginContext } from "../../plugin/types"
import { createMonitorTool } from "./monitor"

type MonitorToolsContext = PluginContext & {
  pluginConfig: OhMyOpenCodeConfig
}

function hasPluginConfig(ctx: PluginContext): ctx is MonitorToolsContext {
  return typeof ctx === "object" && ctx !== null && "pluginConfig" in ctx
}

/** One `monitor` tool; monitors are stopped with background_cancel like every other background job. */
export function createMonitorTools(manager: MonitorManager, ctx: PluginContext): Record<string, ToolDefinition> {
  const pluginConfig = hasPluginConfig(ctx) ? ctx.pluginConfig : { monitor: { enabled: true } }
  return { monitor: createMonitorTool(manager, pluginConfig) }
}

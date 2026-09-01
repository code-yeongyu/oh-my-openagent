import type { ToolDefinition } from "@opencode-ai/plugin"

import type { MonitorManager } from "../../features/monitor"
import type { OhMyOpenCodeConfig } from "../../config"
import type { PluginContext } from "../../plugin/types"
import { createMonitorList } from "./monitor-list"
import { createMonitorOutput } from "./monitor-output"
import { createMonitorStart } from "./monitor-start"
import { createMonitorStop } from "./monitor-stop"

type MonitorToolsContext = PluginContext & {
  pluginConfig: OhMyOpenCodeConfig
}

type MonitorToolsConfig = {
  monitor?: Partial<NonNullable<OhMyOpenCodeConfig["monitor"]>>
}

function hasPluginConfig(ctx: PluginContext): ctx is MonitorToolsContext {
  return typeof ctx === "object" && ctx !== null && "pluginConfig" in ctx
}

export function createMonitorTools(manager: MonitorManager, ctx: PluginContext): Record<string, ToolDefinition> {
  const pluginConfig: MonitorToolsConfig = hasPluginConfig(ctx) ? ctx.pluginConfig : { monitor: { enabled: true } }

  return {
    monitor_start: createMonitorStart(manager, pluginConfig, ctx),
    monitor_stop: createMonitorStop(manager, ctx),
    monitor_list: createMonitorList(manager, { sessionID: "" }),
    monitor_output: createMonitorOutput(manager),
  }
}

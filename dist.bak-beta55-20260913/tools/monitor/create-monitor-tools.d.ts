import type { ToolDefinition } from "@opencode-ai/plugin";
import type { MonitorManager } from "../../features/monitor";
import type { PluginContext } from "../../plugin/types";
export declare function createMonitorTools(manager: MonitorManager, ctx: PluginContext): Record<string, ToolDefinition>;

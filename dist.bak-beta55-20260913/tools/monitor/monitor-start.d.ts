import { type ToolDefinition } from "@opencode-ai/plugin";
import type { OhMyOpenCodeConfig } from "../../config/schema/oh-my-opencode-config";
import type { MonitorManager } from "../../features/monitor/types";
import type { PluginContext } from "../../plugin/types";
type MonitorStartConfig = {
    monitor?: Partial<NonNullable<OhMyOpenCodeConfig["monitor"]>>;
};
export declare function createMonitorStart(manager: MonitorManager, pluginConfig: MonitorStartConfig, _ctx?: PluginContext): ToolDefinition;
export {};

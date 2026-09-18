import type { PluginModule } from "@opencode-ai/plugin";
declare const pluginModule: PluginModule;
export declare const omoPlugin: import("@opencode-ai/plugin").Plugin;
export default pluginModule;
export type { AgentName, AgentOverrideConfig, AgentOverrides, BuiltinCommandName, HookName, McpName, OhMyOpenCodeConfig, } from "./config";
export type { ConfigLoadError } from "./shared/config-errors";

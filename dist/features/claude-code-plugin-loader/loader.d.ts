import type { CommandDefinition } from "../claude-code-command-loader/types";
import type { McpServerConfig } from "../claude-code-mcp-loader/types";
import type { ClaudeCodeAgentConfig } from "../claude-code-agent-loader/types";
import type { HooksConfig, LoadedPlugin, PluginLoadError, PluginLoaderOptions } from "./types";
export { discoverInstalledPlugins } from "./discovery";
export { loadPluginCommands } from "./command-loader";
export { loadPluginSkillsAsCommands } from "./skill-loader";
export { loadPluginAgents } from "./agent-loader";
export { loadPluginMcpServers } from "./mcp-server-loader";
export { loadPluginHooksConfigs } from "./hook-loader";
export interface PluginComponentsResult {
    commands: Record<string, CommandDefinition>;
    skills: Record<string, CommandDefinition>;
    agents: Record<string, ClaudeCodeAgentConfig>;
    mcpServers: Record<string, McpServerConfig>;
    hooksConfigs: HooksConfig[];
    plugins: LoadedPlugin[];
    errors: PluginLoadError[];
}
export declare function loadAllPluginComponents(options?: PluginLoaderOptions): Promise<PluginComponentsResult>;

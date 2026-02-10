import type { OhMyOpenCodeConfig } from "../config";
import { loadMcpConfigs } from "../features/claude-code-mcp-loader";
import { createBuiltinMcps } from "../mcp";
import type { PluginComponents } from "./plugin-components-loader";

export async function applyMcpConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: OhMyOpenCodeConfig;
  pluginComponents: PluginComponents;
}): Promise<void> {
  const mcpResult = params.pluginConfig.claude_code?.mcp ?? true
    ? await loadMcpConfigs()
    : { servers: {} };

  params.config.mcp = {
    ...createBuiltinMcps(params.pluginConfig.disabled_mcps, params.pluginConfig),
    ...(params.config.mcp as Record<string, unknown>),
    ...mcpResult.servers,
    ...params.pluginComponents.mcpServers,
  };
}

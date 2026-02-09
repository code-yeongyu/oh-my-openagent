import type { OhMyOpenCodeConfig } from "../config";
import { loadMcpConfigs } from "../features/claude-code-mcp-loader";
import { createBuiltinMcps } from "../mcp";
import type { PluginComponents } from "./plugin-components-loader";

export async function applyMcpConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: OhMyOpenCodeConfig;
  pluginComponents: PluginComponents;
}): Promise<void> {
  // Preserve user's `enabled: false`, later spreads from .mcp.json would overwrite it.
  const userMcp = params.config.mcp as Record<string, { enabled?: boolean }> | undefined;
  const userDisabledMcps = new Set<string>();
  if (userMcp) {
    for (const [name, mcpConfig] of Object.entries(userMcp)) {
      if (mcpConfig && mcpConfig.enabled === false) {
        userDisabledMcps.add(name);
      }
    }
  }

  const mcpResult = params.pluginConfig.claude_code?.mcp ?? true
    ? await loadMcpConfigs()
    : { servers: {} };

  params.config.mcp = {
    ...createBuiltinMcps(params.pluginConfig.disabled_mcps, params.pluginConfig),
    ...(params.config.mcp as Record<string, unknown>),
    ...mcpResult.servers,
    ...params.pluginComponents.mcpServers,
  };

  if (userDisabledMcps.size > 0) {
    const mergedMcp = params.config.mcp as Record<string, { enabled?: boolean }>;
    for (const name of userDisabledMcps) {
      if (mergedMcp[name]) {
        mergedMcp[name] = { ...mergedMcp[name], enabled: false };
      }
    }
  }
}

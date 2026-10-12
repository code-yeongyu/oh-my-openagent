import type { OhMyOpenCodeConfig } from "../config";
import { loadMcpConfigs } from "../features/claude-code-mcp-loader";
import { createBuiltinMcps } from "../mcp";
import type { PluginComponents } from "./plugin-components-loader";
import { log } from "../shared";
import {
  fingerprintClaudeMcpSources,
  getProcessConfigCacheEntry,
  setProcessConfigCacheEntry,
} from "../shared/process-config-cache";

type McpEntry = Record<string, unknown>;

function isDisabledMcpEntry(value: unknown): value is McpEntry & { enabled: false } {
  return typeof value === "object" && value !== null && (value as McpEntry).enabled === false;
}

function captureUserDisabledMcps(
  userMcp: Record<string, unknown> | undefined
): Set<string> {
  const disabled = new Set<string>();
  if (!userMcp) return disabled;

  for (const [name, value] of Object.entries(userMcp)) {
    if (isDisabledMcpEntry(value)) {
      disabled.add(name);
    }
  }

  return disabled;
}

/**
 * Claude Code MCP configs are directory-independent (they come from
 * ~/.claude.json and ~/.claude settings), so the loaded server set is cached
 * per process (local fix 28, first-message-drop F5c) and invalidated by a
 * fingerprint of those files. Builtin MCPs embed the folder cwd and are still
 * rebuilt per folder.
 */
async function loadCachedMcpConfigs(
  disabledMcps: string[],
): Promise<{ servers: Record<string, unknown> }> {
  const cacheKey = JSON.stringify({
    disabledMcps,
    sources: fingerprintClaudeMcpSources(),
  });
  const cached = getProcessConfigCacheEntry("claudeMcpServers");
  if (cached && cached.key === cacheKey) {
    log("[mcp-config] reusing cached Claude Code MCP configs (process-level)");
    return cached.value as { servers: Record<string, unknown> };
  }
  const result = await loadMcpConfigs(disabledMcps);
  setProcessConfigCacheEntry("claudeMcpServers", { key: cacheKey, value: result });
  return result;
}

export async function applyMcpConfig(params: {
  config: Record<string, unknown>;
  ctx: { directory: string };
  pluginConfig: OhMyOpenCodeConfig;
  pluginComponents: PluginComponents;
}): Promise<void> {
  const disabledMcps = params.pluginConfig.disabled_mcps ?? [];
  const userMcp = params.config.mcp as Record<string, unknown> | undefined;
  const userDisabledMcps = captureUserDisabledMcps(userMcp);

  const mcpResult = params.pluginConfig.claude_code?.mcp ?? true
    ? await loadCachedMcpConfigs(disabledMcps)
    : { servers: {} };

  if (userMcp) {
    for (const name of Object.keys(userMcp)) {
      if (name in mcpResult.servers) {
        log(`warning: MCP server "${name}" from user config overrides Claude Code .mcp.json`);
      }
    }
  }

  const merged = {
    ...createBuiltinMcps(disabledMcps, params.pluginConfig, { cwd: params.ctx.directory }),
    ...mcpResult.servers,
    ...(userMcp ?? {}),
    ...params.pluginComponents.mcpServers,
  } as Record<string, McpEntry>;

  for (const name of userDisabledMcps) {
    if (merged[name]) {
      merged[name] = { ...merged[name], enabled: false };
    }
  }

  const disabledSet = new Set(disabledMcps);
  for (const name of disabledSet) {
    delete merged[name];
  }

  params.config.mcp = merged;
}

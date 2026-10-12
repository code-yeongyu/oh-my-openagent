import type { OhMyOpenCodeConfig } from "../config";
import { loadMcpConfigs } from "../features/claude-code-mcp-loader";
import { createBuiltinMcps } from "../mcp";
import type { PluginComponents } from "./plugin-components-loader";
import { log } from "../shared";
import {
  digestEnvironment,
  fingerprintClaudeMcpSources,
  getProcessConfigCacheEntry,
  resolveClaudeMcpLoaderContext,
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
 * Everything loadMcpConfigs() reads when called without options (local fix
 * 31): the loader context (process cwd, home, Claude config directory), the
 * four files it loads from those (~/.claude.json, <claude config>/.mcp.json,
 * <cwd>/.mcp.json, <cwd>/.claude/.mcp.json), the env-expansion allowlist and
 * the environment the transformer expands variables from.
 */
export function buildClaudeMcpCacheKey(disabledMcps: ReadonlyArray<string>, envAllowlist: ReadonlyArray<string>): string {
  const context = resolveClaudeMcpLoaderContext();
  return JSON.stringify({
    disabledMcps,
    context,
    sources: fingerprintClaudeMcpSources(context),
    envAllowlist: [...envAllowlist].sort(),
    environment: digestEnvironment(),
  });
}

/**
 * The Claude Code MCP server set does not depend on the plugin instance's
 * folder (the loader resolves project files against the process cwd), so it is
 * cached per process (local fix 28, first-message-drop F5c) under a key that
 * covers all of its inputs. Builtin MCPs embed the folder cwd and are still
 * rebuilt per folder.
 */
async function loadCachedMcpConfigs(
  disabledMcps: string[],
  envAllowlist: ReadonlyArray<string>,
): Promise<{ servers: Record<string, unknown> }> {
  const cacheKey = buildClaudeMcpCacheKey(disabledMcps, envAllowlist);
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
    ? await loadCachedMcpConfigs(disabledMcps, params.pluginConfig.mcp_env_allowlist ?? [])
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

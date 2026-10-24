import type { OhMyOpenCodeConfig } from "../config";
import { loadMcpConfigs } from "../features/claude-code-mcp-loader";
import { createBuiltinMcps } from "../mcp";
import type { PluginComponents } from "./plugin-components-loader";
import { log } from "../shared";

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
    ? await loadMcpConfigs(disabledMcps)
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
  } as Record<string, McpEntry>;

  // OpenCode keys MCP OAuth state by server name. A Claude Code plugin MCP is
  // namespaced as "<plugin>:<server>", so when its bare server name matches an
  // already-merged native server (builtin, .mcp.json, or user config) the namespaced
  // duplicate can never satisfy the stored tokens and re-triggers auth on every start.
  for (const [name, entry] of Object.entries(params.pluginComponents.mcpServers)) {
    const bareName = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
    if (bareName !== name && bareName in merged) {
      log(`warning: skipping plugin MCP server "${name}"; native MCP server "${bareName}" already exists`);
      continue;
    }
    merged[name] = entry as McpEntry;
  }

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

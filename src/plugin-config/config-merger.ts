import type { OhMyOpenCodeConfig } from "../config";
import { deepMerge } from "../shared";

function dedupeCaseInsensitive(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function mergeConfigs(
  base: OhMyOpenCodeConfig,
  override: Partial<OhMyOpenCodeConfig>
): OhMyOpenCodeConfig {
  return {
    ...base,
    ...override,
    agents: deepMerge(base.agents, override.agents),
    categories: deepMerge(base.categories, override.categories),
    team_mode: deepMerge(base.team_mode, override.team_mode),
    agent_definitions: [
      ...new Set([
        ...(base.agent_definitions ?? []),
        ...(override.agent_definitions ?? []),
      ]),
    ],
    disabled_agents: [
      ...new Set([
        ...(base.disabled_agents ?? []),
        ...(override.disabled_agents ?? []),
      ]),
    ],
    disabled_mcps: [
      ...new Set([
        ...(base.disabled_mcps ?? []),
        ...(override.disabled_mcps ?? []),
      ]),
    ],
    disabled_hooks: [
      ...new Set([
        ...(base.disabled_hooks ?? []),
        ...(override.disabled_hooks ?? []),
      ]),
    ],
    disabled_commands: [
      ...new Set([
        ...(base.disabled_commands ?? []),
        ...(override.disabled_commands ?? []),
      ]),
    ],
    disabled_skills: [
      ...new Set([
        ...(base.disabled_skills ?? []),
        ...(override.disabled_skills ?? []),
      ]),
    ],
    disabled_tools: [
      ...new Set([
        ...(base.disabled_tools ?? []),
        ...(override.disabled_tools ?? []),
      ]),
    ],
    disabled_providers: dedupeCaseInsensitive([
      ...(base.disabled_providers ?? []),
      ...(override.disabled_providers ?? []),
    ]),
    mcp_env_allowlist: override.mcp_env_allowlist ?? base.mcp_env_allowlist,
    claude_code: deepMerge(base.claude_code, override.claude_code),
  };
}

import type { OhMyOpenCodeConfig } from "../config";
import { deepMerge, mergeUniqueStrings, mergeUniqueStringsCaseInsensitive } from "@oh-my-opencode/utils";

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
    agent_definitions: mergeUniqueStrings(base.agent_definitions, override.agent_definitions),
    disabled_agents: mergeUniqueStrings(base.disabled_agents, override.disabled_agents),
    disabled_mcps: mergeUniqueStrings(base.disabled_mcps, override.disabled_mcps),
    disabled_hooks: mergeUniqueStrings(base.disabled_hooks, override.disabled_hooks),
    disabled_commands: mergeUniqueStrings(base.disabled_commands, override.disabled_commands),
    disabled_skills: mergeUniqueStrings(base.disabled_skills, override.disabled_skills),
    disabled_tools: mergeUniqueStrings(base.disabled_tools, override.disabled_tools),
    disabled_providers: mergeUniqueStringsCaseInsensitive(base.disabled_providers, override.disabled_providers),
    mcp_env_allowlist: override.mcp_env_allowlist ?? base.mcp_env_allowlist,
    claude_code: deepMerge(base.claude_code, override.claude_code),
  };
}

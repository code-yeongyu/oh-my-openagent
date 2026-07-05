import {
  clearRegisteredAgentNames,
  registerAgentName,
} from "../features/claude-code-session-state";
import { log } from "../shared";
import { AGENT_NAME_MAP } from "../shared/migration";
import { setDefaultAgentForSort } from "../shared/agent-sort-shim";
import { setOverrideDisplayNames } from "../shared/agent-display-names";
import { remapAgentKeysToDisplayNames } from "./agent-key-remapper";
import { reorderAgentsByPriority } from "./agent-priority-order";
import type { ApplyAgentConfigParams } from "./agent-config-types";

export function finalizeAgentConfig(
  params: Pick<ApplyAgentConfigParams, "config" | "pluginConfig"> & {
    configuredDefaultAgent: string | undefined;
  },
): Record<string, unknown> {
  // Canonicalize legacy keys in override configs (e.g. "omo" -> "sisyphus")
  // so that override maps match downstream canonicalized keys.
  if (params.pluginConfig.agents) {
    const migratedAgents: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(params.pluginConfig.agents)) {
      const canonicalKey = AGENT_NAME_MAP[key.toLowerCase()] ?? AGENT_NAME_MAP[key] ?? key
      migratedAgents[canonicalKey] = value
    }
    params.pluginConfig.agents = migratedAgents as typeof params.pluginConfig.agents
  }

  // Register override display names BEFORE remapping so reverse lookups
  // (display name → config key) work throughout the plugin lifecycle.
  setOverrideDisplayNames(
    params.pluginConfig.agents as Record<string, { displayName?: string } | undefined> | undefined,
  );

  if (params.config.agent) {
    params.config.agent = remapAgentKeysToDisplayNames(
      params.config.agent as Record<string, unknown>,
      params.pluginConfig.agents as Record<string, { displayName?: string } | undefined> | undefined,
    );
    params.config.agent = reorderAgentsByPriority(
      params.config.agent as Record<string, unknown>,
      params.pluginConfig.agent_order,
    );
  }

  if (params.configuredDefaultAgent) {
    setDefaultAgentForSort(
      (params.config as { default_agent?: string }).default_agent ?? params.configuredDefaultAgent,
    );
  }

  const agentResult =
    params.config.agent != null ? (params.config.agent as Record<string, unknown>) : {};
  clearRegisteredAgentNames();
  for (const name of Object.keys(agentResult)) {
    registerAgentName(name);
  }
  log("[config-handler] agents loaded", { agentKeys: Object.keys(agentResult) });
  return agentResult;
}

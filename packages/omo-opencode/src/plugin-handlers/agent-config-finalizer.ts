import {
  clearRegisteredAgentNames,
  registerAgentName,
} from "../features/claude-code-session-state";
import { log } from "../shared";
import { setDefaultAgentForSort } from "../shared/agent-sort-shim";
import { remapAgentKeysToDisplayNames } from "./agent-key-remapper";
import { reorderAgentsByPriority } from "./agent-priority-order";
import type { ApplyAgentConfigParams } from "./agent-config-types";
/**
 * Translates `providerOptions` to `options` for OpenCode compatibility.
 *
 * omo accepts `providerOptions` in agent override configs, but OpenCode reads
 * provider-specific options from the `options` key on each agent entry. This
 * translation ensures user-configured provider options actually reach the
 * request body sent to the model provider.
 *
 * @see https://github.com/code-yeongyu/oh-my-openagent/issues/5479
 */
export function translateProviderOptions(agent: Record<string, unknown>): Record<string, unknown> {
  const { providerOptions, ...rest } = agent;
  if (
    providerOptions === undefined ||
    providerOptions === null ||
    typeof providerOptions !== "object" ||
    Array.isArray(providerOptions)
  ) {
    return agent;
  }
  const existingOptions =
    typeof rest.options === "object" && rest.options !== null && !Array.isArray(rest.options)
      ? (rest.options as Record<string, unknown>)
      : {};
  return {
    ...rest,
    options: { ...existingOptions, ...(providerOptions as Record<string, unknown>) },
  };
}


export function finalizeAgentConfig(
  params: Pick<ApplyAgentConfigParams, "config" | "pluginConfig"> & {
    configuredDefaultAgent: string | undefined;
  },
): Record<string, unknown> {
  if (params.config.agent) {
    params.config.agent = remapAgentKeysToDisplayNames(
      params.config.agent as Record<string, unknown>,
      params.pluginConfig.agents as Record<string, { displayName?: string } | undefined> | undefined,
    );
    params.config.agent = reorderAgentsByPriority(
      params.config.agent as Record<string, unknown>,
      params.pluginConfig.agent_order,
    );

    // Translate providerOptions -> options so OpenCode forwards them to the provider.
    const agentsMap = params.config.agent as Record<string, unknown>;
    for (const [key, entry] of Object.entries(agentsMap)) {
      if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
        agentsMap[key] = translateProviderOptions(entry as Record<string, unknown>);
      }
    }
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

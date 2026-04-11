import { getAgentListDisplayName } from "../shared/agent-display-names"

/**
 * CRITICAL: This is the ONLY source of truth for core agent ordering.
 * The order is: sisyphus → hephaestus → prometheus → atlas
 *
 * DO NOT CHANGE THIS ORDER. Any PR attempting to modify this order
 * or introduce alternative ordering mechanisms (ZWSP prefixes, sort
 * shims, etc.) will be rejected.
 *
 * See: src/plugin-handlers/AGENTS.md for architectural context.
 */
export const CANONICAL_CORE_AGENT_ORDER = [
  "sisyphus",
  "hephaestus",
  "prometheus",
  "atlas",
] as const

type CoreAgentName = (typeof CANONICAL_CORE_AGENT_ORDER)[number]

const CORE_AGENT_ORDER: ReadonlyArray<{
  configKey: CoreAgentName
  displayName: string
  order: number
}> = CANONICAL_CORE_AGENT_ORDER.map((configKey, index) => ({
  configKey,
  displayName: getAgentListDisplayName(configKey),
  order: index + 1,
}))

const CORE_DISPLAY_NAMES = new Set(CORE_AGENT_ORDER.map((a) => a.displayName))

function injectOrderField(agentConfig: unknown, order: number): unknown {
  if (typeof agentConfig === "object" && agentConfig !== null) {
    return { ...agentConfig, order }
  }
  return agentConfig
}

export function reorderAgentsByPriority(
  agents: Record<string, unknown>,
): Record<string, unknown> {
  const ordered: Record<string, unknown> = {}
  const seen = new Set<string>()

  for (const { displayName, order } of CORE_AGENT_ORDER) {
    if (Object.prototype.hasOwnProperty.call(agents, displayName)) {
      ordered[displayName] = injectOrderField(agents[displayName], order)
      seen.add(displayName)
    }
  }

  const nonCoreKeys = Object.keys(agents)
    .filter((key) => !seen.has(key))
    .sort((a, b) => a.localeCompare(b))

  for (const key of nonCoreKeys) {
    ordered[key] = agents[key]
  }

  return ordered
}

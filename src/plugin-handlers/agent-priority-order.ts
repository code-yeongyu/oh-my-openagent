const CORE_AGENT_ORDER = ["sisyphus", "hephaestus", "prometheus", "atlas"] as const;

export function reorderAgentsByPriority(
  agents: Record<string, unknown>,
): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  const seen = new Set<string>();

  for (const key of CORE_AGENT_ORDER) {
    if (Object.prototype.hasOwnProperty.call(agents, key)) {
      ordered[key] = agents[key];
      seen.add(key);
    }
  }

  for (const [key, value] of Object.entries(agents)) {
    if (!seen.has(key)) {
      ordered[key] = value;
    }
  }

  return ordered;
}

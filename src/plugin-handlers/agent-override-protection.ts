const PARENTHETICAL_SUFFIX_PATTERN = /\s*(\([^)]*\)\s*)+$/u

export function normalizeProtectedAgentName(agentName: string): string {
  return agentName
    .trim()
    .toLowerCase()
    .replace(PARENTHETICAL_SUFFIX_PATTERN, "")
    .replace(/[-_]/g, "")
    .trim()
}

export function createProtectedAgentNameSet(agentNames: Iterable<string>): Set<string> {
  const protectedAgentNames = new Set<string>()

  for (const agentName of agentNames) {
    const normalizedAgentName = normalizeProtectedAgentName(agentName)
    if (normalizedAgentName.length === 0) continue

    protectedAgentNames.add(normalizedAgentName)
  }

  return protectedAgentNames
}

export function filterProtectedAgentOverrides<TAgent>(
  agents: Record<string, TAgent>,
  protectedAgentNames: ReadonlySet<string>,
): Record<string, TAgent> {
  return Object.fromEntries(
    Object.entries(agents).filter(([agentName]) => {
      return !protectedAgentNames.has(normalizeProtectedAgentName(agentName))
    }),
  )
}

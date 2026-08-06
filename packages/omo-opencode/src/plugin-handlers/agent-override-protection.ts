const PARENTHETICAL_SUFFIX_PATTERN = /\s*(\([^)]*\)\s*)+$/u
const DASH_SUFFIX_PATTERN = /\s+-\s+.+$/u
const ZERO_WIDTH_CHARACTERS_PATTERN = /[\u200B\u200C\u200D\uFEFF]/g

export function normalizeProtectedAgentName(agentName: string): string {
  return agentName
    .replace(ZERO_WIDTH_CHARACTERS_PATTERN, "")
    .trim()
    .toLowerCase()
    .replace(PARENTHETICAL_SUFFIX_PATTERN, "")
    .replace(DASH_SUFFIX_PATTERN, "")
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

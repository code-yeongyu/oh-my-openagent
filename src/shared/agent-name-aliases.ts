// Bidirectional alias mapping for custom agent names.
// Maps user-defined display names (aliases) back to canonical agent names for SDK routing,
// and canonical names forward to their registered aliases for UI display.

let aliasToCanonical = new Map<string, string>()
let canonicalToAlias = new Map<string, string>()

export function initializeAgentNameAliases(
  displayNames: Record<string, string> | undefined,
  allCanonicalNames: string[],
): { warnings: string[] } {
  const warnings: string[] = []
  aliasToCanonical = new Map()
  canonicalToAlias = new Map()

  if (!displayNames) return { warnings }

  const canonicalSet = new Set(allCanonicalNames.map((n) => n.toLowerCase()))
  const seenAliases = new Map<string, string>()

  for (const [canonical, alias] of Object.entries(displayNames)) {
    const canonicalLower = canonical.toLowerCase()
    const aliasLower = alias.toLowerCase()

    if (!canonicalSet.has(canonicalLower)) {
      warnings.push(
        `Agent name alias: "${canonical}" is not a known agent name, skipping`,
      )
      continue
    }

    const existingOwner = seenAliases.get(aliasLower)
    if (existingOwner) {
      warnings.push(
        `Agent name alias: "${alias}" is used by both "${existingOwner}" and "${canonical}", skipping duplicate`,
      )
      continue
    }

    if (canonicalSet.has(aliasLower) && aliasLower !== canonicalLower) {
      warnings.push(
        `Agent name alias: "${alias}" for "${canonical}" collides with existing canonical name "${alias}"`,
      )
      continue
    }

    seenAliases.set(aliasLower, canonical)
    aliasToCanonical.set(aliasLower, canonicalLower)
    canonicalToAlias.set(canonicalLower, alias)
  }

  return { warnings }
}

export function toCanonical(name: string): string {
  const lower = name.toLowerCase()
  return aliasToCanonical.get(lower) ?? lower
}

export function toRegistered(name: string): string {
  const lower = name.toLowerCase()
  return canonicalToAlias.get(lower) ?? name
}

export function getCanonicalToRegisteredMap(): ReadonlyMap<string, string> {
  return canonicalToAlias
}

export function hasAliases(): boolean {
  return canonicalToAlias.size > 0
}

export function resetAgentNameAliases(): void {
  aliasToCanonical = new Map()
  canonicalToAlias = new Map()
}

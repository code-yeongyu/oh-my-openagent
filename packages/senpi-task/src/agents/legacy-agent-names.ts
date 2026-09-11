// Retired curated agent ids kept as read aliases for one release. Every input boundary that names
// a subagent (task tool target, dag route, team member, omo.json agent key, resolveAgent callers)
// canonicalizes through this table before the value is compared, stored, or persisted, so callers
// still holding `metis`/`momus` keep working while the ids are retired.
// Alias window: ships in the first tagged publish containing this change (currently 5.0.0-beta.51 per
// package.json); delete in the next tagged publish.
export const LEGACY_AGENT_NAME_ALIASES: Readonly<Record<string, string>> = {
  metis: "plan-consultant",
  momus: "plan-reviewer",
}

export type CanonicalAgentName = {
  readonly name: string
  readonly legacy?: string
}

// Trim + exact-case lookup: unknown names pass through unchanged with no legacy marker.
export function canonicalAgentName(name: string): CanonicalAgentName {
  const trimmed = name.trim()
  const canonical = Object.hasOwn(LEGACY_AGENT_NAME_ALIASES, trimmed)
    ? LEGACY_AGENT_NAME_ALIASES[trimmed]
    : undefined
  return canonical === undefined
    ? { name: trimmed }
    : { name: canonical, legacy: trimmed }
}

export function legacyAgentNameNotice(legacy: string, canonical: string): string {
  return `subagent_type "${legacy}" is deprecated; use "${canonical}". The alias is removed in the next release.`
}

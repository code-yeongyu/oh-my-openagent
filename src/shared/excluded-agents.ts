// Helper for issue #3735 — `excluded_agents` config lets custom lightweight
// agents opt out of omo's runtime prompt injections (ultrawork tag, keyword
// banners, rules/AGENTS.md/README tool-output injection) while keeping the
// rest of the plugin (model resolution, tools, etc.) intact.

/**
 * Normalizes an agent name for case- and separator-insensitive comparison.
 * Mirrors how `disabled_agents` is matched in `cli/run/agent-resolver.ts`.
 */
function normalizeAgentName(name: string): string {
  return name.trim().toLowerCase().replace(/[_\s]+/g, "-")
}

/**
 * Returns true when the given agent should be excluded from omo's runtime
 * prompt injections. Matching is case-insensitive and treats `_`, ` ` and
 * `-` interchangeably, matching the casing tolerance users expect from
 * existing `disabled_agents` behavior.
 *
 * @param agentName The agent name reported by the current session (may be
 *   undefined when OpenCode hasn't routed the message to a named agent yet —
 *   in that case nothing is excluded, since we can't tell).
 * @param excludedAgents The `excluded_agents` array from plugin config.
 */
export function isAgentExcludedFromOmoInjection(
  agentName: string | undefined,
  excludedAgents: readonly string[] | undefined,
): boolean {
  if (!agentName) return false
  if (!excludedAgents || excludedAgents.length === 0) return false
  const target = normalizeAgentName(agentName)
  if (target.length === 0) return false
  return excludedAgents.some((excluded) => normalizeAgentName(excluded) === target)
}

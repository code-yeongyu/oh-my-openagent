import { getAgentListDisplayName } from "../shared/agent-display-names"

type AgentOverridesMap = Record<string, { displayName?: string } | undefined>

function rewriteAgentNameForListDisplay(
  key: string,
  value: unknown,
  overrides?: AgentOverridesMap,
): unknown {
  if (typeof value !== "object" || value === null) {
    return value
  }

  const agent = value as Record<string, unknown>
  return {
    ...agent,
    name: getAgentListDisplayName(key, overrides),
  }
}

export function remapAgentKeysToDisplayNames(
  agents: Record<string, unknown>,
  overrides?: AgentOverridesMap,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(agents)) {
    const displayName = getAgentListDisplayName(key, overrides)
    if (displayName && displayName !== key) {
      result[displayName] = rewriteAgentNameForListDisplay(key, value, overrides)
      // Regression guard: do not also assign result[key].
      // This line was repeatedly re-added and caused duplicate agent rows in the UI.
      // Runtime callers that previously depended on config-key aliases were fixed in:
      // - hooks/atlas/boulder-continuation-injector.ts (prompt agent normalization)
      // - features/claude-code-session-state/state.ts (dual registration for display + config forms)
    } else {
      result[key] = value
    }
  }

  return result
}

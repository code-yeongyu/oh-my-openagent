import { getAgentListDisplayName } from "../shared/agent-display-names"

export function remapAgentKeysToDisplayNames(
  agents: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(agents)) {
    const displayName = getAgentListDisplayName(key)
    if (displayName && displayName !== key) {
      result[displayName] = value
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

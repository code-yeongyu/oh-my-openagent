import { getAgentDisplayName, isUserDisplayNamesActive } from "../shared/agent-display-names"

export function remapAgentKeysToDisplayNames(
  agents: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const preserveOriginalKeys = !isUserDisplayNamesActive()

  for (const [key, value] of Object.entries(agents)) {
    const displayName = getAgentDisplayName(key)
    result[displayName] = value
    if (preserveOriginalKeys && displayName !== key) {
      result[key] = value
    }
  }

  return result
}

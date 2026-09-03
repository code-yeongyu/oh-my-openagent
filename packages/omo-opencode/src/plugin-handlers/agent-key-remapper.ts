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
  const hiddenAliases: Array<[string, unknown]> = []

  for (const [key, value] of Object.entries(agents)) {
    const displayName = getAgentListDisplayName(key, overrides)
    if (displayName && displayName !== key) {
      result[displayName] = rewriteAgentNameForListDisplay(key, value, overrides)
      // Hidden config-key alias so `opencode run --agent sisyphus` resolves after display-name remap.
      // Appended after visible keys so TUI/priority order still sees display names first.
      const alias =
        typeof value === "object" && value !== null
          ? { ...(value as Record<string, unknown>) }
          : {}
      hiddenAliases.push([
        key,
        {
          ...alias,
          name: displayName,
          hidden: true,
        },
      ])
    } else {
      result[key] = value
    }
  }

  for (const [key, value] of hiddenAliases) {
    if (!(key in result)) {
      result[key] = value
    }
  }

  return result
}

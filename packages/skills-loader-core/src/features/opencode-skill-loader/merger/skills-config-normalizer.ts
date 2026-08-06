import type { SkillsConfig, SkillDefinition } from "../../../types"

export function normalizeSkillsConfig(config: SkillsConfig | undefined): {
  sources: Array<string | { path: string; recursive?: boolean; glob?: string }>
  enable: string[]
  disable: string[]
  entries: Record<string, boolean | SkillDefinition>
} {
  if (!config) {
    return { sources: [], enable: [], disable: [], entries: {} }
  }

  if (Array.isArray(config)) {
    return { sources: [], enable: config, disable: [], entries: {} }
  }

  const { sources = [], enable = [], disable = [], ...rawEntries } = config
  const entries: Record<string, boolean | SkillDefinition> = {}
  for (const [key, value] of Object.entries(rawEntries)) {
    if (typeof value === "boolean" || (typeof value === "object" && value !== null && !Array.isArray(value))) {
      entries[key] = value
    }
  }
  return { sources, enable, disable, entries }
}

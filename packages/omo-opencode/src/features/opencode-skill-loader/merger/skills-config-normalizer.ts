import type { SkillsConfig, SkillDefinition } from "../../../config/schema"

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

  const { sources = [], enable = [], disable = [], ...entries } = config
  return { sources, enable, disable, entries }
}

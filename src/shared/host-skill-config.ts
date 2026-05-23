import type { SkillsConfig } from "../config/schema/skills"

type HostSkillConfig = {
  paths?: unknown
  urls?: unknown
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

// Note: only `skills.paths` is honored today. `skills.urls` from the host
// opencode.jsonc is intentionally NOT forwarded because the downstream
// loader (`discoverConfigSourceSkills` -> `loadSourcePath`) returns an
// empty list for `http(s)://` entries. Passing URLs through would create
// the false impression that they are materialized when they are not. If
// URL fetch is implemented later, add `...toStringArray(hostSkillConfig.urls)`
// back into `sources`.
export function adaptHostSkillConfig(value: unknown): SkillsConfig | undefined {
  if (!value || typeof value !== "object") return undefined

  const hostSkillConfig = value as HostSkillConfig
  const sources = toStringArray(hostSkillConfig.paths)

  if (sources.length === 0) return undefined

  return { sources } as SkillsConfig
}

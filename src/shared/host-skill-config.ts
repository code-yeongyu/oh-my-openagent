import type { SkillsConfig } from "../config/schema/skills"

type HostSkillConfig = {
  paths?: unknown
  urls?: unknown
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

export function adaptHostSkillConfig(value: unknown): SkillsConfig | undefined {
  if (!value || typeof value !== "object") return undefined

  const hostSkillConfig = value as HostSkillConfig
  const sources = [
    ...toStringArray(hostSkillConfig.paths),
    ...toStringArray(hostSkillConfig.urls),
  ]

  if (sources.length === 0) return undefined

  return { sources } as SkillsConfig
}

export function createHostSkillConfigStore() {
  let current: SkillsConfig | undefined

  return {
    get(): SkillsConfig | undefined {
      return current
    },
    set(value: unknown): void {
      current = adaptHostSkillConfig(value)
    },
  }
}

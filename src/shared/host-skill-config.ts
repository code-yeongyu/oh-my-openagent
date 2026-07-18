import type { SkillsConfig } from "../config/schema"
export interface HostSkillConfig {
  paths?: unknown[]
  urls?: unknown[]
}
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
}
/**
 * Adapt host opencode.json `skills` field into the SkillsConfig shape
 * consumed by discoverConfigSourceSkills. Only `paths` is forwarded;
 * `urls` are intentionally dropped (downstream loader does not fetch HTTP).
 */
export function adaptHostSkillConfig(value: unknown): SkillsConfig | undefined {
  if (!value || typeof value !== "object") return undefined
  const host = value as HostSkillConfig
  const sources = toStringArray(host.paths)
  if (sources.length === 0) return undefined
  return { sources } as SkillsConfig
}

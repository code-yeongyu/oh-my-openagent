import type { SkillResolution, TaskSkillSummary } from "./types"

export function taskSkillSummary(
  requested: readonly string[],
  resolution: SkillResolution,
): TaskSkillSummary | undefined {
  if (requested.length === 0) return undefined
  return {
    requested: [...requested],
    resolved: [...resolution.resolved],
    missing: [...resolution.missing],
  }
}

export function appendMissingSkills(
  text: string,
  summaries: TaskSkillSummary | readonly (TaskSkillSummary | undefined)[] | undefined,
): string {
  const list = summaries === undefined ? [] : Array.isArray(summaries) ? summaries : [summaries]
  const missing = [...new Set(list.flatMap((summary) => summary?.missing ?? []))]
  return missing.length === 0 ? text : `${text}\n\nMissing skills: ${missing.join(", ")}. Child started without them.`
}

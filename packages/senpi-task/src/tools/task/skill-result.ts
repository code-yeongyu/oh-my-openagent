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
    ...(resolution.rejected?.length ? { rejected: resolution.rejected } : {}),
  }
}

function isSummaryList(
  value: TaskSkillSummary | readonly (TaskSkillSummary | undefined)[],
): value is readonly (TaskSkillSummary | undefined)[] {
  return Array.isArray(value)
}

export function appendMissingSkills(
  text: string,
  summaries: TaskSkillSummary | readonly (TaskSkillSummary | undefined)[] | undefined,
): string {
  const list: readonly (TaskSkillSummary | undefined)[] =
    summaries === undefined ? [] : isSummaryList(summaries) ? summaries : [summaries]
  const missing = [...new Set(list.flatMap((summary) => summary?.missing ?? []))]
  const rejected = [...new Set(list.flatMap((summary) => summary?.rejected?.map((entry) => entry.reason) ?? []))]
  const withMissing = missing.length === 0 ? text : `${text}\n\nMissing skills: ${missing.join(", ")}. Child started without them.`
  return rejected.length === 0 ? withMissing : `${withMissing}\n\n${rejected.join("\n")}`
}

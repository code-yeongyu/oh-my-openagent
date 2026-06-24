import type { LoadedSkill } from "./types"

function deduplicationKey(skillName: string): string {
  const lowerName = skillName.toLowerCase()
  return lowerName.startsWith("shared/") ? lowerName : skillName
}

export function deduplicateSkillsByName(skills: LoadedSkill[]): LoadedSkill[] {
  const seen = new Set<string>()
  const result: LoadedSkill[] = []
  for (const skill of skills) {
    const key = deduplicationKey(skill.name)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(skill)
    }
  }
  return result
}

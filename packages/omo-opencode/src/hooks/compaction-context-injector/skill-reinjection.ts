import type { CompactionSkillSnapshot } from "../../shared/compaction-agent-config-checkpoint"

export function formatCheckpointedSkillsText(
  skills: CompactionSkillSnapshot[] | undefined,
): string | undefined {
  if (!skills?.length) {
    return undefined
  }

  const sections = skills.map((skill) =>
    [`## Skill: ${skill.name}`, "", skill.body].join("\n"),
  )

  return [
    "[restored skill instructions loaded earlier in this session; re-injected after compaction]",
    "",
    ...sections,
  ].join("\n\n")
}

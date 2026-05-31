import type { BuiltinSkill } from "../builtin-skills/types"

export type OpenCodeSkillMarkdown = {
  readonly name: string
  readonly description: string
  readonly markdown: string
}

export function createOpenCodeSkillMarkdown(skill: BuiltinSkill): OpenCodeSkillMarkdown {
  const body = skill.template.trimStart()
  const markdown = [
    "---",
    `name: ${skill.name}`,
    `description: ${JSON.stringify(skill.description)}`,
    "---",
    "",
    body,
  ].join("\n")

  return {
    name: skill.name,
    description: skill.description,
    markdown,
  }
}

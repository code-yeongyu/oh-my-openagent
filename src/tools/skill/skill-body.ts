import type { LoadedSkill } from "../../features/opencode-skill-loader"
import { extractSkillTemplate } from "../../features/opencode-skill-loader/skill-content"

const SKILL_INSTRUCTION_PATTERN = /<skill-instruction>([\s\S]*?)<\/skill-instruction>/

function trimSkillInstruction(template: string): string {
  const templateMatch = template.match(SKILL_INSTRUCTION_PATTERN)
  return templateMatch ? templateMatch[1].trim() : template
}

export async function extractSkillBody(skill: LoadedSkill): Promise<string> {
  if (skill.lazyContent) {
    const fullTemplate = await skill.lazyContent.load()
    return trimSkillInstruction(fullTemplate)
  }

  if (skill.scope === "config" && skill.definition.template) {
    return trimSkillInstruction(skill.definition.template)
  }

  if (skill.path) {
    return extractSkillTemplate(skill)
  }

  return trimSkillInstruction(skill.definition.template || "")
}

import type { LoadedSkill } from "../../features/opencode-skill-loader"
import { extractSkillTemplate } from "../../features/opencode-skill-loader/skill-content"
import { readSkillFileChecked, skillProvenance, reportSkillLoadError } from "@oh-my-opencode/skills-loader-core/opencode-skill-loader"
import { parseFrontmatter } from "@oh-my-opencode/utils"
import { resolveSkillPathReferences } from "@oh-my-opencode/skills-loader-core/shared/skill-path-resolver"
import { dirname } from "node:path"

const SKILL_INSTRUCTION_PATTERN = /<skill-instruction>([\s\S]*?)<\/skill-instruction>/

function trimSkillInstruction(template: string): string {
  const templateMatch = template.match(SKILL_INSTRUCTION_PATTERN)
  return templateMatch ? templateMatch[1].trim() : template
}

export async function extractSkillBody(skill: LoadedSkill): Promise<string> {
  if (skill.path && skillProvenance(skill.path, skill.scope, skill.provenance).kind === "project-auto") {
    try {
      const body = parseFrontmatter(readSkillFileChecked(skill.path, skillProvenance(skill.path, skill.scope, skill.provenance))).body.trim()
      return resolveSkillPathReferences(body, skill.resolvedPath ?? dirname(skill.path))
    } catch (error) {
      reportSkillLoadError(error, skill.path)
      throw error
    }
  }
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

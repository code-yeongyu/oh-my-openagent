import { parseFrontmatter } from "@oh-my-opencode/utils"
import type { LoadedSkill } from "./types"
import { readSkillFileChecked } from "./checked-skill-read"
import { skillProvenance } from "./skill-provenance"

export function extractSkillTemplate(skill: LoadedSkill): string {
  if (skill.provenance?.kind !== "project-auto" && skill.scope === "config" && skill.definition.template) {
    return skill.definition.template
  }

  if (skill.path) {
    const content = readSkillFileChecked(skill.path, skillProvenance(skill.path, skill.scope, skill.provenance))
    const { body } = parseFrontmatter(content)
		return body.trim()
	}
	return skill.definition.template || ""
}

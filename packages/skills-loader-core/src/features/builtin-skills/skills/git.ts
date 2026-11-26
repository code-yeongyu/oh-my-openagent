import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

import { GIT_SKILL_DESCRIPTION, GIT_SKILL_NAME } from "./git-skill-metadata"

export const gitSkill: BuiltinSkill = {
  name: GIT_SKILL_NAME,
  description: GIT_SKILL_DESCRIPTION,
  template: loadSharedSkillTemplate(GIT_SKILL_NAME),
}

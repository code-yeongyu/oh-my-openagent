import type { BuiltinSkill } from "../types"
import { readBuiltinSkillTemplate } from "./template-reader"

export const writingSkillsSkill: BuiltinSkill = {
  name: "writing-skills",
  description: "Use when creating new skills, editing existing skills, or verifying skills work before deployment",
  template: readBuiltinSkillTemplate("writing-skills"),
}

export const continuousLearningSkill: BuiltinSkill = {
  name: "continuous-learning",
  description: "Continuous learning and instinct system - automatically learns from successful patterns and creates reusable instincts",
  template: readBuiltinSkillTemplate("continuous-learning"),
}

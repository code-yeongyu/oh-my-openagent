import type { BuiltinSkill } from "../types"
import { readBuiltinSkillTemplate } from "./template-reader"

export const requestingCodeReviewSkill: BuiltinSkill = {
  name: "requesting-code-review",
  description: "Use when completing tasks, implementing major features, or before merging to verify work meets requirements",
  template: readBuiltinSkillTemplate("requesting-code-review"),
}

export const receivingCodeReviewSkill: BuiltinSkill = {
  name: "receiving-code-review",
  description: "Use when receiving code review feedback; verify, clarify, and respond with technical rigor before implementing anything",
  template: readBuiltinSkillTemplate("receiving-code-review"),
}

import type { BuiltinSkill } from "../types"
import { securityResearchSkill } from "./security-research"

export const securityReviewSkill: BuiltinSkill = {
	name: "security-review",
	description: `Alias for security-research. ${securityResearchSkill.description}`,
	template: securityResearchSkill.template,
}

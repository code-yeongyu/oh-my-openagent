import type { BuiltinSkill } from "../types"
import { securityResearchSkill } from "./security-research"

export const securityReviewSkill: BuiltinSkill = {
	name: "security-review",
	description: `Alias for security-research and /security-review. ${securityResearchSkill.description}`,
	template: securityResearchSkill.template,
}

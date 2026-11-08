import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const reviewWorkSkill: BuiltinSkill = {
	name: "review-work",
	description:
		"Post-implementation gate review: run manual QA on the real surface yourself, then launch ONE gate reviewer (never a panel) to audit goal, constraints, code quality, security, missed context, and QA evidence. Use before a PR handoff or when the user explicitly asks to review completed work.",
	template: loadSharedSkillTemplate("review-work"),
}

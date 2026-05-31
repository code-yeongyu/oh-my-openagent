import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const frontendUiUxSkill: BuiltinSkill = {
	name: "frontend-ui-ux",
	description: "Designer-turned-developer who crafts stunning UI/UX even without design mockups",
	template: loadSharedSkillTemplate("frontend-ui-ux"),
}

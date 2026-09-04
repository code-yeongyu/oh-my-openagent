import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const frontendSkill: BuiltinSkill = {
	name: "frontend",
	description: "Builds, styles, and polishes web UI and UX. Use for any frontend, page, component, styling, layout, animation, or visual-quality task, or when asked to make an interface look or feel a certain way.",
	template: loadSharedSkillTemplate("frontend"),
}

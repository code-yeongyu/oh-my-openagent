import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const visualQaSkill: BuiltinSkill = {
	name: "visual-qa",
	description:
		"Runs rigorous visual QA across web, terminal, and paginated surfaces with screenshot evidence and a verdict. Use for any UI build or change, or when asked whether a page, component, or TUI looks right.",
	template: loadSharedSkillTemplate("visual-qa"),
}

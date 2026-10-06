import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const visualQaSkill: BuiltinSkill = {
	name: "visual-qa",
	description:
		"Runs rigorous visual QA across web, terminal, and paginated surfaces: an Apple HIG-based checklist, paired light/dark captures at phone and desktop widths, screenshot evidence, and a per-item PASS/FAIL verdict. Use for any UI build or change, or when asked whether a page, component, or TUI looks right or follows the platform's design guidelines.",
	template: loadSharedSkillTemplate("visual-qa"),
}

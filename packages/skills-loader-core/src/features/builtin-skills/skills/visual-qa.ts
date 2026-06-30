import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const visualQaSkill: BuiltinSkill = {
	name: "visual-qa",
	description:
		"MUST USE after building/changing any UI or when asked whether a page, component, or TUI looks right. Rigorous visual QA across web/page and terminal UIs. Prefer browser:control-in-app-browser for unauthenticated browser/page QA in Codex, then Playwright/agent-browser/dev-browser. Captures screenshot/TUI evidence with bundled diff scripts, runs design-system/functional and visual-fidelity/CJK reviewer passes, then synthesizes a good/bad verdict. Triggers: visual QA, screenshot/pixel diff, UI looks wrong, reference fidelity, design system check, responsive check, CJK text clipping, TUI alignment, box-drawing drift.",
	template: loadSharedSkillTemplate("visual-qa"),
}

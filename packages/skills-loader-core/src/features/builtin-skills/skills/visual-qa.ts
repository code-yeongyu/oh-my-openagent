import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const visualQaSkill: BuiltinSkill = {
	name: "visual-qa",
	description:
		"Rigorous visual QA for any UI you built or changed, across BOTH web/page UIs and TUI/terminal UIs. MUST USE after building or changing any UI to verify it visually before declaring it done. Captures objective reference evidence with a bundled diff script (image-diff for screenshots, tui-check for terminal captures), then runs two parallel read-only oracle passes (design-system and functional integrity; visual fidelity and CJK precision) and synthesizes one good/bad verdict. Triggers: visual QA, visual regression, screenshot diff, pixel diff, image comparison, UI looks wrong, design system check, is this really a design system or just an image, alpha channel breakage, responsive check, CJK text, Korean/Japanese/Chinese text clipping, baseline drop, glyph drop, TUI alignment, terminal UI, tmux capture, box-drawing border misalignment, wide-character column drift. Use it even when the user does not say visual QA but asks whether a page, component, or terminal layout looks right.",
	template: loadSharedSkillTemplate("visual-qa"),
}

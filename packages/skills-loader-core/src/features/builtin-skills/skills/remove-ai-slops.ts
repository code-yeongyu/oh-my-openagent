import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const removeAiSlopsSkill: BuiltinSkill = {
	name: "remove-ai-slops",
	description:
		"Removes AI-generated code smells from branch changes or an explicit file list behind regression tests. Use when the user asks to clean up, deslop, or remove AI-slop patterns from recent changes.",
	template: loadSharedSkillTemplate("remove-ai-slops"),
}

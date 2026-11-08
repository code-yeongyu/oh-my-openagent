import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const removeAiSlopsSkill: BuiltinSkill = {
	name: "remove-ai-slops",
	description:
		"Removes AI-generated code smells from branch changes or an explicit file list behind regression tests, including junk tests (prose pins, source greps, copied inventories, mock echoes), each proven by its class's rule before a cut. Use when the user asks to clean up, deslop, remove AI-slop patterns, or prune tests from recent changes.",
	template: loadSharedSkillTemplate("remove-ai-slops"),
}

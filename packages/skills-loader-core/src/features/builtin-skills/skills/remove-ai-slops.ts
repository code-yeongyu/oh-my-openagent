import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const removeAiSlopsSkill: BuiltinSkill = {
	name: "remove-ai-slops",
	description:
		'Remove AI-generated code smells (slop) from branch changes or an explicit file list. Locks behavior with regression tests FIRST, then runs categorized cleanup via parallel `deep` agents in batches of 5, then verifies with quality gates. Covers 10 slop categories including performance equivalences, excessive complexity (object annotations, if/elif variant chains), and oversized modules (250+ pure LOC with mandatory modular refactoring). MUST USE when the user asks to "remove slop", "clean AI code", "deslop", "clean up AI-generated code", "remove AI slop", or wants to clean up AI-generated patterns from recent changes. Triggers - "remove ai slops", "clean ai code", "deslop", "cleanup AI generated", "remove AI slop", "clean up AI-generated code", "strip slop", "ai-slop cleanup".',
	template: loadSharedSkillTemplate("remove-ai-slops"),
}

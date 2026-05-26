import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const aiSlopRemoverSkill: BuiltinSkill = {
	name: "ai-slop-remover",
	description:
		"Removes AI-generated code smells from a SINGLE file while preserving functionality. For multiple files, call in PARALLEL per file.",
	template: loadSharedSkillTemplate("ai-slop-remover"),
}

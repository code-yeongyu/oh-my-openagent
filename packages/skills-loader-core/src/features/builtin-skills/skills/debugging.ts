import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const debuggingSkill: BuiltinSkill = {
	name: "debugging",
	description:
		"Runs a hypothesis-driven debugging loop across any language or binary, escalating to orthogonal oracle angles and locking the fix with a failing test. Use for crashes, silent failures, hangs, wrong responses, memory leaks, async misbehavior, or reverse engineering.",
	template: loadSharedSkillTemplate("debugging"),
}

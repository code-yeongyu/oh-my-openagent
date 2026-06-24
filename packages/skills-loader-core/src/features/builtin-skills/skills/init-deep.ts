import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const initDeepSkill: BuiltinSkill = {
	name: "init-deep",
	description: "(builtin) Initialize hierarchical AGENTS.md knowledge base",
	template: loadSharedSkillTemplate("init-deep"),
	argumentHint: "[--create-new] [--max-depth=N]",
}

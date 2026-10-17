import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const initDeepSkill: BuiltinSkill = {
	name: "init-deep",
	description: "Initializes a hierarchical AGENTS.md knowledge base for a project. Use when a repo needs its structure, commands, and conventions documented for agents.",
	template: loadSharedSkillTemplate("init-deep"),
	argumentHint: "[--create-new] [--max-depth=N]",
}

/// <reference path="../../../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"
import { createBuiltinSkills } from "../../features/builtin-skills"
import type { LoadedSkill } from "../../features/opencode-skill-loader"
import { executeSlashCommand } from "./executor"

function asLoadedSkill(name: string): LoadedSkill {
	const skill = createBuiltinSkills().find((candidate) => candidate.name === name)
	if (!skill) {
		throw new Error(`missing builtin skill: ${name}`)
	}

	return {
		name: skill.name,
		definition: {
			name: skill.name,
			description: skill.description,
			template: skill.template,
			argumentHint: skill.argumentHint,
		},
		scope: "builtin",
	}
}

describe("init-deep slash surface", () => {
	test("#given init-deep builtin skill #when slash command executes #then it renders skill instructions with arguments", async () => {
		// given
		const skills = [asLoadedSkill("init-deep")]

		// when
		const result = await executeSlashCommand(
			{ command: "init-deep", args: "--max-depth=2", raw: "/init-deep --max-depth=2" },
			{ skills, pluginsEnabled: false },
		)

		// then
		expect(result.success).toBe(true)
		expect(result.replacementText).toContain("**Scope**: skill")
		expect(result.replacementText).toContain("--max-depth=2")
		expect(result.replacementText).toContain("Generate hierarchical AGENTS.md files")
	})
})

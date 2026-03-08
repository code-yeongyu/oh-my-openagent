import { describe, expect, it } from "bun:test"
import { createCompactionSkillInjector } from "./hook"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"

function makeSkill(name: string, scope: LoadedSkill["scope"], description: string): LoadedSkill {
	return {
		name,
		scope,
		definition: {
			name,
			description,
			template: "",
		},
	} as LoadedSkill
}

describe("compaction-skill-injector", () => {
	describe("#given skills are available", () => {
		it("#when compaction fires #then injects skill index with names and descriptions", async () => {
			const skills = [
				makeSkill("git-master", "builtin", "Atomic git commits, rebase/squash"),
				makeSkill("my-workflow", "project", "Project-specific deployment skill"),
			]
			const injector = createCompactionSkillInjector(async () => skills, "/project")

			const result = await injector()

			expect(result).toContain("SKILL INDEX")
			expect(result).toContain("git-master (builtin)")
			expect(result).toContain("Atomic git commits")
			expect(result).toContain("my-workflow (project)")
			expect(result).toContain("Project-specific deployment skill")
		})

		it("#when skill has loader-prefixed description #then strips scope prefix", async () => {
			const skills = [makeSkill("frontend-ui-ux", "builtin", "(builtin - Skill) Designer-turned-developer")]
			const injector = createCompactionSkillInjector(async () => skills, "/project")

			const result = await injector()

			expect(result).toContain("Designer-turned-developer")
			expect(result).not.toContain("(builtin - Skill)")
		})

		it("#when description exceeds 120 chars #then truncates with ellipsis", async () => {
			const longDesc = "A".repeat(130)
			const skills = [makeSkill("verbose-skill", "project", longDesc)]
			const injector = createCompactionSkillInjector(async () => skills, "/project")

			const result = await injector()

			expect(result).toContain("…")
			const line = result.split("\n").find((l) => l.includes("verbose-skill"))
			expect(line).toBeDefined()
			expect(line!.length).toBeLessThan(160)
		})

		it("#when skill has no description #then omits colon and description", async () => {
			const skills = [makeSkill("bare-skill", "project", "")]
			const injector = createCompactionSkillInjector(async () => skills, "/project")

			const result = await injector()

			expect(result).toContain("- bare-skill (project)")
			const line = result.split("\n").find((l) => l.includes("bare-skill"))!
			expect(line.endsWith("(project)")).toBeTrue()
		})
	})

	describe("#given no skills are available", () => {
		it("#when skill list is empty #then returns no-skills message", async () => {
			const injector = createCompactionSkillInjector(async () => [], "/project")

			const result = await injector()

			expect(result).toContain("SKILL INDEX")
			expect(result).toContain("No skills are currently available")
		})
	})

	describe("#given skill discovery fails", () => {
		it("#when getAllSkills throws #then returns fallback message without crashing", async () => {
			const injector = createCompactionSkillInjector(async () => {
				throw new Error("discovery failed")
			}, "/project")

			const result = await injector()

			expect(result).toContain("SKILL INDEX")
			expect(result).toContain("unavailable")
		})
	})
})

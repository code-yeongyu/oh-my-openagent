import { describe, it, expect } from "bun:test"
import { matchSkillByName } from "./skill-matcher"
import type { LoadedSkill } from "../../features/opencode-skill-loader"

function createLoadedSkill(name: string, scope: LoadedSkill["scope"]): LoadedSkill {
	return {
		name,
		definition: { name, description: `${name} description`, template: `${name} body` },
		scope,
	}
}

describe("matchSkillByName", () => {
	it("matches by exact name case-insensitively", () => {
		const skills = [createLoadedSkill("frontend", "shared")]

		const match = matchSkillByName(skills, "Frontend")

		expect(match?.name).toBe("frontend")
		expect(match?.scope).toBe("shared")
	})

	it("matches a user-configured skill whose literal name contains a slash", () => {
		const skills = [createLoadedSkill("shared/custom", "project")]

		const match = matchSkillByName(skills, "shared/custom")

		expect(match?.name).toBe("shared/custom")
		expect(match?.scope).toBe("project")
	})

	it("no longer resolves shared/<name> as a canonical alias for a shared skill", () => {
		const skills = [createLoadedSkill("frontend", "shared")]

		const match = matchSkillByName(skills, "shared/frontend")

		expect(match).toBeUndefined()
	})

	it("falls back to a unique short name for nested skills", () => {
		const skills = [createLoadedSkill("toolkit/systematic-debugging", "project")]

		const match = matchSkillByName(skills, "systematic-debugging")

		expect(match?.name).toBe("toolkit/systematic-debugging")
	})

	it("returns undefined when the short name is ambiguous", () => {
		const skills = [
			createLoadedSkill("toolkit/debugging", "project"),
			createLoadedSkill("utils/debugging", "project"),
		]

		const match = matchSkillByName(skills, "debugging")

		expect(match).toBeUndefined()
	})
})

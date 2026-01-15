import { describe, it, expect } from "bun:test"
import { resolveSkillContent, resolveMultipleSkills, resolveSkillContentAsync, resolveMultipleSkillsAsync } from "./skill-content"

describe("resolveSkillContent", () => {
	it("should return template for existing skill", () => {
		// #given: builtin skills with 'frontend-ui-ux' skill
		// #when: resolving content for 'frontend-ui-ux'
		const result = resolveSkillContent("frontend-ui-ux")

		// #then: returns template string
		expect(result).not.toBeNull()
		expect(typeof result).toBe("string")
		expect(result).toContain("Role: Designer-Turned-Developer")
	})

	it("should return template for 'playwright' skill", () => {
		// #given: builtin skills with 'playwright' skill
		// #when: resolving content for 'playwright'
		const result = resolveSkillContent("playwright")

		// #then: returns template string
		expect(result).not.toBeNull()
		expect(typeof result).toBe("string")
		expect(result).toContain("Playwright Browser Automation")
	})

	it("should return null for non-existent skill", () => {
		// #given: builtin skills without 'nonexistent' skill
		// #when: resolving content for 'nonexistent'
		const result = resolveSkillContent("nonexistent")

		// #then: returns null
		expect(result).toBeNull()
	})

	it("should return null for empty string", () => {
		// #given: builtin skills
		// #when: resolving content for empty string
		const result = resolveSkillContent("")

		// #then: returns null
		expect(result).toBeNull()
	})
})

describe("resolveMultipleSkills", () => {
	it("should resolve all existing skills", () => {
		// #given: list of existing skill names
		const skillNames = ["frontend-ui-ux", "playwright"]

		// #when: resolving multiple skills
		const result = resolveMultipleSkills(skillNames)

		// #then: all skills resolved, none not found
		expect(result.resolved.size).toBe(2)
		expect(result.notFound).toEqual([])
		expect(result.resolved.get("frontend-ui-ux")).toContain("Designer-Turned-Developer")
		expect(result.resolved.get("playwright")).toContain("Playwright Browser Automation")
	})

	it("should handle partial success - some skills not found", () => {
		// #given: list with existing and non-existing skills
		const skillNames = ["frontend-ui-ux", "nonexistent", "playwright", "another-missing"]

		// #when: resolving multiple skills
		const result = resolveMultipleSkills(skillNames)

		// #then: resolves existing skills, lists not found skills
		expect(result.resolved.size).toBe(2)
		expect(result.notFound).toEqual(["nonexistent", "another-missing"])
		expect(result.resolved.get("frontend-ui-ux")).toContain("Designer-Turned-Developer")
		expect(result.resolved.get("playwright")).toContain("Playwright Browser Automation")
	})

	it("should handle empty array", () => {
		// #given: empty skill names list
		const skillNames: string[] = []

		// #when: resolving multiple skills
		const result = resolveMultipleSkills(skillNames)

		// #then: returns empty resolved and notFound
		expect(result.resolved.size).toBe(0)
		expect(result.notFound).toEqual([])
	})

	it("should handle all skills not found", () => {
		// #given: list of non-existing skills
		const skillNames = ["skill-one", "skill-two", "skill-three"]

		// #when: resolving multiple skills
		const result = resolveMultipleSkills(skillNames)

		// #then: no skills resolved, all in notFound
		expect(result.resolved.size).toBe(0)
		expect(result.notFound).toEqual(["skill-one", "skill-two", "skill-three"])
	})

	it("should preserve skill order in resolved map", () => {
		// #given: list of skill names in specific order
		const skillNames = ["playwright", "frontend-ui-ux"]

		// #when: resolving multiple skills
		const result = resolveMultipleSkills(skillNames)

		// #then: map contains skills with expected keys
		expect(result.resolved.has("playwright")).toBe(true)
		expect(result.resolved.has("frontend-ui-ux")).toBe(true)
		expect(result.resolved.size).toBe(2)
	})
})

describe("resolveSkillContentAsync", () => {
	it("should return template for builtin skill", async () => {
		// #given: builtin skill 'frontend-ui-ux'
		// #when: resolving content async
		const result = await resolveSkillContentAsync("frontend-ui-ux")

		// #then: returns template string
		expect(result).not.toBeNull()
		expect(typeof result).toBe("string")
		expect(result).toContain("Role: Designer-Turned-Developer")
	})

	it("should return null for non-existent skill", async () => {
		// #given: non-existent skill name
		// #when: resolving content async
		const result = await resolveSkillContentAsync("definitely-not-a-skill-12345")

		// #then: returns null
		expect(result).toBeNull()
	})
})

describe("resolveMultipleSkillsAsync", () => {
	it("should resolve builtin skills", async () => {
		// #given: builtin skill names
		const skillNames = ["playwright", "frontend-ui-ux"]

		// #when: resolving multiple skills async
		const result = await resolveMultipleSkillsAsync(skillNames)

		// #then: all builtin skills resolved
		expect(result.resolved.size).toBe(2)
		expect(result.notFound).toEqual([])
		expect(result.resolved.get("playwright")).toContain("Playwright Browser Automation")
		expect(result.resolved.get("frontend-ui-ux")).toContain("Designer-Turned-Developer")
	})

	it("should handle partial success with non-existent skills", async () => {
		// #given: mix of existing and non-existing skills
		const skillNames = ["playwright", "nonexistent-skill-12345"]

		// #when: resolving multiple skills async
		const result = await resolveMultipleSkillsAsync(skillNames)

		// #then: existing skills resolved, non-existing in notFound
		expect(result.resolved.size).toBe(1)
		expect(result.notFound).toEqual(["nonexistent-skill-12345"])
		expect(result.resolved.get("playwright")).toContain("Playwright Browser Automation")
	})

	it("should support git-master config injection", async () => {
		// #given: git-master skill with config override
		const skillNames = ["git-master"]
		const options = {
			gitMasterConfig: {
				commit_footer: false,
				include_co_authored_by: false,
			},
		}

		// #when: resolving with git-master config
		const result = await resolveMultipleSkillsAsync(skillNames, options)

		// #then: config values injected into template
		expect(result.resolved.size).toBe(1)
		expect(result.notFound).toEqual([])
		const gitMasterContent = result.resolved.get("git-master")
		expect(gitMasterContent).toContain("commit_footer")
		expect(gitMasterContent).toContain("DISABLED")
	})

	it("should handle empty array", async () => {
		// #given: empty skill names
		const skillNames: string[] = []

		// #when: resolving multiple skills async
		const result = await resolveMultipleSkillsAsync(skillNames)

		// #then: empty results
		expect(result.resolved.size).toBe(0)
		expect(result.notFound).toEqual([])
	})
})

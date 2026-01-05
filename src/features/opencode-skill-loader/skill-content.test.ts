import { describe, it, expect } from "bun:test"
import { resolveSkillContent, resolveMultipleSkills } from "./skill-content"

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

import { describe, it, expect } from "bun:test"
import { resolveSkillContent, resolveMultipleSkills } from "./skill-content"
import type { LoadedSkill, SkillScope } from "./types"

const mockPluginSkills: Map<string, LoadedSkill> = new Map([
	[
		"test-plugin:test-skill",
		{
			name: "test-plugin:test-skill",
			definition: {
				name: "test-plugin:test-skill",
				description: "A test plugin skill",
				template: "This is the test plugin skill template content.",
			},
			scope: "plugin" as SkillScope,
		},
	],
	[
		"another-plugin:another-skill",
		{
			name: "another-plugin:another-skill",
			definition: {
				name: "another-plugin:another-skill",
				description: "Another test plugin skill",
				template: "Another plugin skill template for testing.",
			},
			scope: "plugin" as SkillScope,
		},
	],
])

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

describe("plugin skills", () => {
	describe("resolveSkillContent with plugin skills", () => {
		it("should return template for plugin skill when provided in options", () => {
			// #given: plugin skills map with 'test-plugin:test-skill'
			// #when: resolving content for plugin skill with pluginSkills option
			const result = resolveSkillContent("test-plugin:test-skill", {
				pluginSkills: mockPluginSkills,
			})

			// #then: returns plugin skill template
			expect(result).not.toBeNull()
			expect(result).toBe("This is the test plugin skill template content.")
		})

		it("should return null for plugin skill when pluginSkills not provided", () => {
			// #given: no pluginSkills in options
			// #when: resolving content for plugin skill without pluginSkills
			const result = resolveSkillContent("test-plugin:test-skill")

			// #then: returns null (plugin skill not found in builtins)
			expect(result).toBeNull()
		})

		it("should prioritize plugin skill over builtin if name conflicts", () => {
			// #given: plugin skill with same name as builtin (hypothetical)
			const conflictingPluginSkills: Map<string, LoadedSkill> = new Map([
				[
					"frontend-ui-ux",
					{
						name: "frontend-ui-ux",
						definition: {
							name: "frontend-ui-ux",
							description: "Plugin override",
							template: "PLUGIN OVERRIDE CONTENT",
						},
						scope: "plugin" as SkillScope,
					},
				],
			])

			// #when: resolving with conflicting plugin skill
			const result = resolveSkillContent("frontend-ui-ux", {
				pluginSkills: conflictingPluginSkills,
			})

			// #then: plugin skill takes priority
			expect(result).toBe("PLUGIN OVERRIDE CONTENT")
		})
	})

	describe("resolveMultipleSkills with plugin skills", () => {
		it("should resolve plugin skills when provided in options", () => {
			// #given: list with plugin skill names
			const skillNames = ["test-plugin:test-skill"]

			// #when: resolving with pluginSkills option
			const result = resolveMultipleSkills(skillNames, {
				pluginSkills: mockPluginSkills,
			})

			// #then: plugin skill resolved
			expect(result.resolved.size).toBe(1)
			expect(result.notFound).toEqual([])
			expect(result.resolved.get("test-plugin:test-skill")).toBe(
				"This is the test plugin skill template content."
			)
		})

		it("should resolve mixed builtin and plugin skills", () => {
			// #given: list with both builtin and plugin skills
			const skillNames = ["playwright", "test-plugin:test-skill", "frontend-ui-ux"]

			// #when: resolving with pluginSkills option
			const result = resolveMultipleSkills(skillNames, {
				pluginSkills: mockPluginSkills,
			})

			// #then: all skills resolved
			expect(result.resolved.size).toBe(3)
			expect(result.notFound).toEqual([])
			expect(result.resolved.get("playwright")).toContain("Playwright Browser Automation")
			expect(result.resolved.get("test-plugin:test-skill")).toBe(
				"This is the test plugin skill template content."
			)
			expect(result.resolved.get("frontend-ui-ux")).toContain("Designer-Turned-Developer")
		})

		it("should report plugin skill as not found when pluginSkills not provided", () => {
			// #given: plugin skill name without pluginSkills option
			const skillNames = ["test-plugin:test-skill", "playwright"]

			// #when: resolving without pluginSkills
			const result = resolveMultipleSkills(skillNames)

			// #then: plugin skill in notFound, builtin resolved
			expect(result.resolved.size).toBe(1)
			expect(result.notFound).toEqual(["test-plugin:test-skill"])
			expect(result.resolved.get("playwright")).toContain("Playwright Browser Automation")
		})

		it("should resolve multiple plugin skills", () => {
			// #given: list with multiple plugin skills
			const skillNames = ["test-plugin:test-skill", "another-plugin:another-skill"]

			// #when: resolving with pluginSkills option
			const result = resolveMultipleSkills(skillNames, {
				pluginSkills: mockPluginSkills,
			})

			// #then: all plugin skills resolved
			expect(result.resolved.size).toBe(2)
			expect(result.notFound).toEqual([])
			expect(result.resolved.get("test-plugin:test-skill")).toBe(
				"This is the test plugin skill template content."
			)
			expect(result.resolved.get("another-plugin:another-skill")).toBe(
				"Another plugin skill template for testing."
			)
		})
	})
})

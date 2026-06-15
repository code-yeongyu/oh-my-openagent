/// <reference types="bun-types" />

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdirSync, writeFileSync } from "node:fs"
import {
	clearSkillCache,
	resolveSkillContent,
	resolveMultipleSkills,
	resolveSkillContentAsync,
	resolveMultipleSkillsAsync,
} from "./skill-content"

function createNestedSkill(baseDir: string, namespace: string, name: string, content: string): void {
	const dir = join(baseDir, "skills", namespace, name)
	mkdirSync(dir, { recursive: true })
	const yaml = `---\nname: ${name}\ndescription: ${namespace}/${name} skill\n---\n${content}`
	writeFileSync(join(dir, "SKILL.md"), yaml)
}

let originalEnv: Record<string, string | undefined>
let testConfigDir: string

beforeEach(() => {
	clearSkillCache()
	originalEnv = {
		CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
		OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
	}
	const unique = `skill-content-test-${Date.now()}-${Math.random().toString(16).slice(2)}`
	testConfigDir = join(tmpdir(), unique)
	process.env.CLAUDE_CONFIG_DIR = testConfigDir
	process.env.OPENCODE_CONFIG_DIR = testConfigDir
})

afterEach(() => {
	clearSkillCache()
	for (const [key, value] of Object.entries(originalEnv)) {
		if (value !== undefined) {
			process.env[key] = value
		} else {
			delete process.env[key]
		}
	}
})

describe("resolveSkillContent", () => {
	it("should return template for existing skill", () => {
		// given: builtin skills with 'frontend' skill
		// when: resolving content for 'frontend'
		const result = resolveSkillContent("frontend")

		// then: returns template string
		expect(result).not.toBeNull()
		expect(typeof result).toBe("string")
		expect(result).toContain("router, not a rulebook")
	})

	it("should return template for 'playwright' skill", () => {
		// given: builtin skills with 'playwright' skill
		// when: resolving content for 'playwright'
		const result = resolveSkillContent("playwright")

		// then: returns template string
		expect(result).not.toBeNull()
		expect(typeof result).toBe("string")
		expect(result).toContain("Playwright Browser Automation")
	})

	it("should return null for non-existent skill", () => {
		// given: builtin skills without 'nonexistent' skill
		// when: resolving content for 'nonexistent'
		const result = resolveSkillContent("nonexistent")

		// then: returns null
		expect(result).toBeNull()
	})

	it("should return null for disabled skill", () => {
		// given: frontend skill disabled
		const options = { disabledSkills: new Set(["frontend"]) }

		// when: resolving content for disabled skill
		const result = resolveSkillContent("frontend", options)

		// then: returns null
		expect(result).toBeNull()
	})
})

describe("resolveMultipleSkills", () => {
	it("should resolve all existing skills", () => {
		// given: list of existing skill names
		const skillNames = ["frontend", "playwright"]

		// when: resolving multiple skills
		const result = resolveMultipleSkills(skillNames)

		// then: all skills resolved, none not found
		expect(result.resolved.size).toBe(2)
		expect(result.notFound).toEqual([])
		expect(result.resolved.get("frontend")).toContain("router, not a rulebook")
		expect(result.resolved.get("playwright")).toContain("Playwright Browser Automation")
	})

	it("should handle partial success - some skills not found", () => {
		// given: list with existing and non-existing skills
		const skillNames = ["frontend", "nonexistent", "playwright", "another-missing"]

		// when: resolving multiple skills
		const result = resolveMultipleSkills(skillNames)

		// then: resolves existing skills, lists not found skills
		expect(result.resolved.size).toBe(2)
		expect(result.notFound).toEqual(["nonexistent", "another-missing"])
		expect(result.resolved.get("frontend")).toContain("router, not a rulebook")
		expect(result.resolved.get("playwright")).toContain("Playwright Browser Automation")
	})

	it("should handle empty array", () => {
		// given: empty skill names list
		const skillNames: string[] = []

		// when: resolving multiple skills
		const result = resolveMultipleSkills(skillNames)

		// then: returns empty resolved and notFound
		expect(result.resolved.size).toBe(0)
		expect(result.notFound).toEqual([])
	})

	it("should handle all skills not found", () => {
		// given: list of non-existing skills
		const skillNames = ["skill-one", "skill-two", "skill-three"]

		// when: resolving multiple skills
		const result = resolveMultipleSkills(skillNames)

		// then: no skills resolved, all in notFound
		expect(result.resolved.size).toBe(0)
		expect(result.notFound).toEqual(["skill-one", "skill-two", "skill-three"])
	})

	it("should treat disabled skills as not found", () => {
		// #given: frontend disabled, playwright not disabled
		const skillNames = ["frontend", "playwright"]
		const options = { disabledSkills: new Set(["frontend"]) }

		// #when: resolving multiple skills with disabled one
		const result = resolveMultipleSkills(skillNames, options)

		// #then: frontend in notFound, playwright resolved
		expect(result.resolved.size).toBe(1)
		expect(result.resolved.has("playwright")).toBe(true)
		expect(result.notFound).toEqual(["frontend"])
	})

	it("should preserve skill order in resolved map", () => {
		// given: list of skill names in specific order
		const skillNames = ["playwright", "frontend"]

		// when: resolving multiple skills
		const result = resolveMultipleSkills(skillNames)

		// then: map contains skills with expected keys
		expect(result.resolved.has("playwright")).toBe(true)
		expect(result.resolved.has("frontend")).toBe(true)
		expect(result.resolved.size).toBe(2)
	})
})

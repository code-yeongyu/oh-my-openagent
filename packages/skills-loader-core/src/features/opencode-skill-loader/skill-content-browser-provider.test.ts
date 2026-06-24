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

describe("resolveSkillContent with browserProvider", () => {
	it("should resolve agent-browser skill when browserProvider is 'agent-browser'", () => {
		// given: browserProvider set to agent-browser
		const options = { browserProvider: "agent-browser" as const }

		// when: resolving content for 'agent-browser'
		const result = resolveSkillContent("agent-browser", options)

		// then: returns agent-browser template
		expect(result).not.toBeNull()
		expect(result).toContain("agent-browser")
	})

	it("should return null for agent-browser when browserProvider is default", () => {
		// given: no browserProvider (defaults to playwright)

		// when: resolving content for 'agent-browser'
		const result = resolveSkillContent("agent-browser")

		// then: returns null because agent-browser is not in default builtin skills
		expect(result).toBeNull()
	})

	it("should return null for playwright when browserProvider is agent-browser", () => {
		// given: browserProvider set to agent-browser
		const options = { browserProvider: "agent-browser" as const }

		// when: resolving content for 'playwright'
		const result = resolveSkillContent("playwright", options)

		// then: returns null because playwright is replaced by agent-browser
		expect(result).toBeNull()
	})
})

describe("resolveMultipleSkills with browserProvider", () => {
	it("should resolve agent-browser when browserProvider is set", () => {
		// given: agent-browser and git-master requested with browserProvider
		const skillNames = ["agent-browser", "git-master"]
		const options = { browserProvider: "agent-browser" as const }

		// when: resolving multiple skills
		const result = resolveMultipleSkills(skillNames, options)

		// then: both resolved
		expect(result.resolved.has("agent-browser")).toBe(true)
		expect(result.resolved.has("git-master")).toBe(true)
		expect(result.notFound).toHaveLength(0)
	})

	it("should not resolve agent-browser without browserProvider option", () => {
		// given: agent-browser requested without browserProvider
		const skillNames = ["agent-browser"]

		// when: resolving multiple skills
		const result = resolveMultipleSkills(skillNames)

		// then: agent-browser not found
		expect(result.resolved.has("agent-browser")).toBe(false)
		expect(result.notFound).toContain("agent-browser")
	})
})

describe("resolveMultipleSkillsAsync with browserProvider filtering", () => {
	it("should exclude discovered agent-browser when browserProvider is playwright", async () => {
		// given: playwright is the selected browserProvider (default)
		const skillNames = ["playwright", "git-master"]
		const options = { browserProvider: "playwright" as const }

		// when: resolving multiple skills
		const result = await resolveMultipleSkillsAsync(skillNames, options)

		// then: playwright resolved, agent-browser would be excluded if discovered
		expect(result.resolved.has("playwright")).toBe(true)
		expect(result.resolved.has("git-master")).toBe(true)
		expect(result.notFound).not.toContain("playwright")
	})

	it("should exclude discovered playwright when browserProvider is agent-browser", async () => {
		// given: agent-browser is the selected browserProvider
		const skillNames = ["agent-browser", "git-master"]
		const options = { browserProvider: "agent-browser" as const }

		// when: resolving multiple skills
		const result = await resolveMultipleSkillsAsync(skillNames, options)

		// then: agent-browser resolved, playwright would be excluded if discovered
		expect(result.resolved.has("agent-browser")).toBe(true)
		expect(result.resolved.has("git-master")).toBe(true)
		expect(result.notFound).not.toContain("agent-browser")
	})
})

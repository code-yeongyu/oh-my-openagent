/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearSkillCache, resolveMultipleSkillsAsync, resolveSkillContentAsync } from "./skill-content"

let originalEnv: Record<string, string | undefined>
let testConfigDir: string

beforeEach(() => {
	clearSkillCache()
	originalEnv = {
		CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
		OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
	}
	const unique = `git-master-async-precedence-${Date.now()}-${Math.random().toString(16).slice(2)}`
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

function createConfiguredGitMasterSkill(content: string): void {
	const exactDir = join(testConfigDir, "skills", "git-master")
	mkdirSync(exactDir, { recursive: true })
	writeFileSync(join(exactDir, "SKILL.md"), `---\nname: git-master\ndescription: exact git master\n---\n${content}`)
}

describe("git-master async precedence", () => {
	it("prefers configured git-master over builtin git-master", async () => {
		// given: a configured git-master skill overrides the builtin
		createConfiguredGitMasterSkill("custom git master content")

		// when: resolving git-master by exact name
		const result = await resolveSkillContentAsync("git-master")

		// then: configured skill wins over the builtin
		expect(result).not.toBeNull()
		expect(result).toContain("custom git master content")
		expect(result).not.toContain("Git Master Agent")
	})

	it("prefers configured git-master over builtin git-master in batch", async () => {
		// given: a configured git-master skill overrides the builtin
		createConfiguredGitMasterSkill("custom git master content")

		// when: resolving git-master in a batch
		const result = await resolveMultipleSkillsAsync(["git-master", "playwright"])

		// then: configured git-master wins while unrelated builtins still resolve
		expect(result.resolved.size).toBe(2)
		expect(result.notFound).toEqual([])
		expect(result.resolved.get("git-master")).toContain("custom git master content")
		expect(result.resolved.get("git-master")).not.toContain("Git Master Agent")
		expect(result.resolved.get("playwright")).toContain("Playwright Browser Automation")
	})

	it("preserves requested batch order when git-master uses the fast path", async () => {
		// given: a configured git-master skill and an unrelated builtin requested first
		createConfiguredGitMasterSkill("custom git master content")

		// when: resolving a batch with git-master after another skill
		const result = await resolveMultipleSkillsAsync(["playwright", "git-master"])

		// then: resolved map order still follows the requested skill order
		expect([...result.resolved.keys()]).toEqual(["playwright", "git-master"])
		expect(result.notFound).toEqual([])
		expect(result.resolved.get("git-master")).toContain("custom git master content")
	})
})

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

describe("resolveMultipleSkillsAsync", () => {
	it("should resolve builtin skills async", async () => {
		// given: builtin skill names
		const skillNames = ["playwright", "git-master"]

		// when: resolving multiple skills async
		const result = await resolveMultipleSkillsAsync(skillNames)

		// then: all builtin skills resolved
		expect(result.resolved.size).toBe(2)
		expect(result.notFound).toEqual([])
		expect(result.resolved.get("playwright")).toContain("Playwright Browser Automation")
		expect(result.resolved.get("git-master")).toContain("Git Master Agent")
	})

	it("should handle partial success with non-existent skills async", async () => {
		// given: mix of existing and non-existing skills
		const skillNames = ["playwright", "nonexistent-skill-12345"]

		// when: resolving multiple skills async
		const result = await resolveMultipleSkillsAsync(skillNames)

		// then: existing skills resolved, non-existing in notFound
		expect(result.resolved.size).toBe(1)
		expect(result.notFound).toEqual(["nonexistent-skill-12345"])
		expect(result.resolved.get("playwright")).toContain("Playwright Browser Automation")
	})

	it("should treat disabled skills as not found async", async () => {
		// #given: frontend disabled
		const skillNames = ["frontend", "playwright"]
		const options = { disabledSkills: new Set(["frontend"]) }

		// #when: resolving multiple skills async with disabled one
		const result = await resolveMultipleSkillsAsync(skillNames, options)

		// #then: frontend in notFound, playwright resolved
		expect(result.resolved.size).toBe(1)
		expect(result.resolved.has("playwright")).toBe(true)
		expect(result.notFound).toEqual(["frontend"])
	})

	it("should NOT inject watermark when both options are disabled", async () => {
		// given: git-master skill with watermark disabled
		const skillNames = ["git-master"]
		const options = {
			gitMasterConfig: {
				commit_footer: false,
				include_co_authored_by: false,
				git_env_prefix: "GIT_MASTER=1",
			},
		}

		// when: resolving with git-master config
		const result = await resolveMultipleSkillsAsync(skillNames, options)

		// then: no watermark section injected
		expect(result.resolved.size).toBe(1)
		expect(result.notFound).toEqual([])
		const gitMasterContent = result.resolved.get("git-master")
		expect(gitMasterContent).not.toContain("Ultraworked with")
		expect(gitMasterContent).not.toContain("Co-authored-by: Sisyphus")
	})

	it("should inject watermark when enabled (default)", async () => {
		// given: git-master skill with default config (watermark enabled)
		const skillNames = ["git-master"]
		const options = {
			gitMasterConfig: {
				commit_footer: true,
				include_co_authored_by: true,
				git_env_prefix: "GIT_MASTER=1",
			},
		}

		// when: resolving with git-master config
		const result = await resolveMultipleSkillsAsync(skillNames, options)

		// then: watermark section is injected
		expect(result.resolved.size).toBe(1)
		const gitMasterContent = result.resolved.get("git-master")
		expect(gitMasterContent).toContain("Ultraworked with [Sisyphus]")
		expect(gitMasterContent).toContain("Co-authored-by: Sisyphus")
	})

	it("should inject only footer when co-author is disabled", async () => {
		// given: git-master skill with only footer enabled
		const skillNames = ["git-master"]
		const options = {
			gitMasterConfig: {
				commit_footer: true,
				include_co_authored_by: false,
				git_env_prefix: "GIT_MASTER=1",
			},
		}

		// when: resolving with git-master config
		const result = await resolveMultipleSkillsAsync(skillNames, options)

		// then: only footer is injected
		const gitMasterContent = result.resolved.get("git-master")
		expect(gitMasterContent).toContain("Ultraworked with [Sisyphus]")
		expect(gitMasterContent).not.toContain("Co-authored-by: Sisyphus")
	})

	it("should inject watermark by default when no config provided", async () => {
		// given: git-master skill with NO config (default behavior)
		const skillNames = ["git-master"]

		// when: resolving without any gitMasterConfig
		const result = await resolveMultipleSkillsAsync(skillNames)

		// then: watermark is injected (default is ON)
		expect(result.resolved.size).toBe(1)
		const gitMasterContent = result.resolved.get("git-master")
		expect(gitMasterContent).toContain("Ultraworked with [Sisyphus]")
		expect(gitMasterContent).toContain("Co-authored-by: Sisyphus")
	})

	it("should inject only co-author when footer is disabled", async () => {
		// given: git-master skill with only co-author enabled
		const skillNames = ["git-master"]
		const options = {
			gitMasterConfig: {
				commit_footer: false,
				include_co_authored_by: true,
				git_env_prefix: "GIT_MASTER=1",
			},
		}

		// when: resolving with git-master config
		const result = await resolveMultipleSkillsAsync(skillNames, options)

		// then: only co-author is injected
		const gitMasterContent = result.resolved.get("git-master")
		expect(gitMasterContent).not.toContain("Ultraworked with [Sisyphus]")
		expect(gitMasterContent).toContain("Co-authored-by: Sisyphus")
	})

	it("should inject custom string footer when commit_footer is a string", async () => {
		// given: git-master skill with custom string footer
		const skillNames = ["git-master"]
		const customFooter = "Custom footer from my team"
		const options = {
			gitMasterConfig: {
				commit_footer: customFooter,
				include_co_authored_by: false,
				git_env_prefix: "GIT_MASTER=1",
			},
		}

		// when: resolving with custom footer config
		const result = await resolveMultipleSkillsAsync(skillNames, options)

		// then: custom footer is injected instead of default
		const gitMasterContent = result.resolved.get("git-master")
		expect(gitMasterContent).toContain(customFooter)
		expect(gitMasterContent).not.toContain("Ultraworked with [Sisyphus]")
	})

	it("should use default Sisyphus footer when commit_footer is boolean true", async () => {
		// given: git-master skill with boolean true footer
		const skillNames = ["git-master"]
		const options = {
			gitMasterConfig: {
				commit_footer: true,
				include_co_authored_by: false,
				git_env_prefix: "GIT_MASTER=1",
			},
		}

		// when: resolving with boolean true footer config
		const result = await resolveMultipleSkillsAsync(skillNames, options)

		// then: default Sisyphus footer is injected
		const gitMasterContent = result.resolved.get("git-master")
		expect(gitMasterContent).toContain("Ultraworked with [Sisyphus]")
	})

	it("should handle empty array", async () => {
		// given: empty skill names
		const skillNames: string[] = []

		// when: resolving multiple skills async
		const result = await resolveMultipleSkillsAsync(skillNames)

		// then: empty results
		expect(result.resolved.size).toBe(0)
		expect(result.notFound).toEqual([])
	})

	it("resolves nested skill by unique short name in mixed batch", async () => {
		// given: nested skill and builtin skill
		createNestedSkill(testConfigDir, "toolkit", "systematic-debugging", "short name resolved")

		// when: mixing short name with full builtin name
		const result = await resolveMultipleSkillsAsync(["systematic-debugging", "playwright"])

		// then: both resolved
		expect(result.resolved.size).toBe(2)
		expect(result.notFound).toEqual([])
		expect(result.resolved.get("systematic-debugging")).toContain("short name resolved")
		expect(result.resolved.get("playwright")).toContain("Playwright Browser Automation")
	})

	it("does not resolve ambiguous short name in batch", async () => {
		// given: two skills with same short name
		createNestedSkill(testConfigDir, "toolkit", "nested-debug", "sp content")
		createNestedSkill(testConfigDir, "utils", "nested-debug", "utils content")

		// when: resolving ambiguous short name with builtin
		const result = await resolveMultipleSkillsAsync(["nested-debug", "playwright"])

		// then: ambiguous short name not found, playwright resolved
		expect(result.resolved.size).toBe(1)
		expect(result.resolved.has("playwright")).toBe(true)
		expect(result.notFound).toContain("nested-debug")
	})

	it("prefers exact match over short name in batch", async () => {
		// given: an exact skill and a nested skill with same base name
		const exactDir = join(testConfigDir, "skills", "debugging")
		mkdirSync(exactDir, { recursive: true })
		writeFileSync(join(exactDir, "SKILL.md"), "---\nname: debugging\ndescription: exact debugging\n---\nexact match content")
		createNestedSkill(testConfigDir, "toolkit", "debugging", "nested content")

		// when: resolving "debugging" in batch
		const result = await resolveMultipleSkillsAsync(["debugging", "playwright"])

		// then: exact match wins
		expect(result.resolved.size).toBe(2)
		expect(result.notFound).toEqual([])
		expect(result.resolved.get("debugging")).toContain("exact match content")
	})
})

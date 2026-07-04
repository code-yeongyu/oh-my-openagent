/// <reference types="bun-types" />

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import {
	clearSkillCache,
	resolveSkillContent,
	resolveMultipleSkills,
	resolveSkillContentAsync,
	resolveMultipleSkillsAsync,
} from "./skill-content"
import { getAllSkills } from "./skill-discovery"
import { matchSkillByName } from "../../tools/skill/skill-matcher"
import type { LoadedSkill } from "./types"

function createNestedSkill(baseDir: string, namespace: string, name: string, content: string): void {
	const dir = join(baseDir, "skills", namespace, name)
	mkdirSync(dir, { recursive: true })
	const yaml = `---\nname: ${name}\ndescription: ${namespace}/${name} skill\n---\n${content}`
	writeFileSync(join(dir, "SKILL.md"), yaml)
}

function createLoadedSkill(name: string, scope: LoadedSkill["scope"]): LoadedSkill {
	return {
		name,
		definition: { name, description: `${name} description`, template: `${name} body` },
		scope,
	}
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

describe("resolveSkillContentAsync", () => {
	it("should return template for builtin skill async", async () => {
		// given: builtin skill 'frontend'
		// when: resolving content async
		const options = { disabledSkills: new Set(["frontend"]) }
		const result = await resolveSkillContentAsync("git-master", options)

		// then: returns template string
		expect(result).not.toBeNull()
		expect(typeof result).toBe("string")
		expect(result).toContain("Git Master Agent")
	})

	it("should return null for disabled skill async", async () => {
		// given: frontend disabled
		const options = { disabledSkills: new Set(["frontend"]) }

		// when: resolving content async for disabled skill
		const result = await resolveSkillContentAsync("frontend", options)

		// then: returns null
		expect(result).toBeNull()
	})

	it("#given the shared ulw-plan canonical alias is disabled #when resolving it async #then it does not fall back to the plain shared alias", async () => {
		// given
		const options = { directory: testConfigDir, disabledSkills: new Set(["shared/ulw-plan"]) }

		// when
		const result = await resolveSkillContentAsync("shared/ulw-plan", options)

		// then
		expect(result).toBeNull()
	})

	it("#given the shared ulw-plan canonical alias is disabled #when matching against all skills #then no shared fallback match remains", async () => {
		// given
		const options = { directory: testConfigDir, disabledSkills: new Set(["shared/ulw-plan"]) }

		// when
		const skills = await getAllSkills(options)
		const matchedSkill = matchSkillByName(skills, "shared/ulw-plan")

		// then
		expect(matchedSkill).toBeUndefined()
	})

	it("#given a project skill whose literal name starts with shared slash #when matching by exact name #then the project skill remains reachable", () => {
		// given
		const skills = [createLoadedSkill("shared/custom", "project")]

		// when
		const matchedSkill = matchSkillByName(skills, "shared/custom")

		// then
		expect(matchedSkill?.scope).toBe("project")
		expect(matchedSkill?.name).toBe("shared/custom")
	})

	it("#given a local ulw-plan override exists #when only the shared canonical alias is disabled #then the local plain override still resolves", async () => {
		// given
		const localSkillDir = join(testConfigDir, ".opencode", "skills", "ulw-plan")
		mkdirSync(localSkillDir, { recursive: true })
		writeFileSync(
			join(localSkillDir, "SKILL.md"),
			"---\nname: ulw-plan\ndescription: Local ulw-plan override\n---\nlocal ulw-plan body"
		)
		const options = { directory: testConfigDir, disabledSkills: new Set(["shared/ulw-plan"]) }

		// when
		const result = await resolveSkillContentAsync("ulw-plan", options)

		// then
		expect(result).toBe("local ulw-plan body")
	})

	it("#given the plain ulw-plan name is disabled #when resolving the shared canonical alias #then the shared alias is disabled too", async () => {
		// given
		const options = { directory: testConfigDir, disabledSkills: new Set(["ulw-plan"]) }

		// when
		const result = await resolveSkillContentAsync("shared/ulw-plan", options)

		// then
		expect(result).toBeNull()
	})

	it("resolves nested skill by unique short name async", async () => {
		// given: a discovered nested skill toolkit/systematic-debugging
		createNestedSkill(testConfigDir, "toolkit", "systematic-debugging", "Short name test content")

		// when: resolving by short name
		const result = await resolveSkillContentAsync("systematic-debugging")

		// then: finds the nested skill
		expect(result).not.toBeNull()
		expect(result).toContain("Short name test content")
	})

	it("returns null for ambiguous short name async", async () => {
		// given: two skills with same short name in different namespaces
		createNestedSkill(testConfigDir, "toolkit", "nested-debug", "toolkit content")
		createNestedSkill(testConfigDir, "utils", "nested-debug", "utils content")

		// when: resolving by ambiguous short name
		const result = await resolveSkillContentAsync("nested-debug")

		// then: ambiguous => null
		expect(result).toBeNull()
	})

	it("prefers exact match over short name match async", async () => {
		// given: an exact skill name "debugging" and a nested "toolkit/debugging"
		createNestedSkill(testConfigDir, "toolkit", "debugging", "nested debugging")
		// Exact match as a non-namespaced dir with SKILL.md
		const exactDir = join(testConfigDir, "skills", "debugging")
		mkdirSync(exactDir, { recursive: true })
		writeFileSync(join(exactDir, "SKILL.md"), "---\nname: debugging\ndescription: exact debugging\n---\nexact match content")

		// when: resolving by name "debugging"
		const result = await resolveSkillContentAsync("debugging")

		// then: prefers exact match over the nested one
		expect(result).not.toBeNull()
		expect(result).toContain("exact match content")
	})

	it("is case-insensitive for short name matching async", async () => {
		// given: a nested skill with lowercase name
		createNestedSkill(testConfigDir, "toolkit", "systematic-debugging", "case insensitive match")

		// when: resolving by uppercase short name
		const result = await resolveSkillContentAsync("Systematic-Debugging")

		// then: finds it case-insensitively
		expect(result).not.toBeNull()
		expect(result).toContain("case insensitive match")
	})

	it("#given the shared ulw-plan skill source #when OpenCode skills are resolved #then ulw-plan is path-backed with workflow resources", async () => {
		// given
		const requiredResourcePaths = [
			"references/full-workflow.md",
			"references/intent-clear.md",
			"references/intent-unclear.md",
			"scripts/scaffold-plan.mjs",
		]

		// when
		const skills = await getAllSkills({ directory: testConfigDir })
		const skill = skills.find((candidate) => candidate.name === "ulw-plan")

		// then
		expect(skill).toBeDefined()
		if (!skill) {
			throw new Error("ulw-plan skill was not resolved")
		}
		expect(skill.path).toBeDefined()
		expect(skill.resolvedPath).toBeDefined()
		if (!skill.path || !skill.resolvedPath) {
			throw new Error("ulw-plan skill is not path-backed")
		}
		expect(skill.path.replaceAll("\\", "/").endsWith("packages/shared-skills/skills/ulw-plan/SKILL.md")).toBe(true)
		for (const relativePath of requiredResourcePaths) {
			expect(existsSync(join(skill.resolvedPath, relativePath))).toBe(true)
		}
		const fullWorkflow = readFileSync(join(skill.resolvedPath, "references/full-workflow.md"), "utf8")
		expect(fullWorkflow).not.toContain("--dangerously-bypass-approvals-and-sandbox")
		expect(fullWorkflow).not.toContain("dangerously-bypass")
	})
})

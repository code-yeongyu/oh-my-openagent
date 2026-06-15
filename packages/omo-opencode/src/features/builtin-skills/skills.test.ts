/// <reference path="../../../../../bun-test.d.ts" />

import { describe, test, expect } from "bun:test"
import { createBuiltinSkills } from "./skills"
import { agentBrowserSkill, playwrightSkill } from "./skills/playwright"

describe("createBuiltinSkills", () => {
	test("returns playwright skill by default", () => {
		// given - no options (default)

		// when
		const skills = createBuiltinSkills()

		// then
		const browserSkill = skills.find((s) => s.name === "playwright")
		expect(browserSkill).toBeDefined()
		expect(browserSkill?.description).toContain("browser")
		expect(browserSkill?.mcpConfig?.playwright).toBeDefined()
	})

	test("exports browser skill contracts with stable tool surfaces", () => {
		// #given - direct browser skill exports

		// #when
		const playwrightMcp = playwrightSkill.mcpConfig?.playwright

		// #then
		expect(playwrightSkill.name).toBe("playwright")
		expect(playwrightMcp?.command).toBe("npx")
		expect(playwrightMcp?.args).toEqual(["@playwright/mcp@latest"])
		expect(agentBrowserSkill.name).toBe("agent-browser")
		expect(agentBrowserSkill.allowedTools).toEqual(["Bash(agent-browser:*)"])
	})

	test("returns playwright skill when browserProvider is 'playwright'", () => {
		// given
		const options = { browserProvider: "playwright" as const }

		// when
		const skills = createBuiltinSkills(options)

		// then
		const playwrightSkill = skills.find((s) => s.name === "playwright")
		const agentBrowserSkill = skills.find((s) => s.name === "agent-browser")
		const devBrowserSkill = skills.find((s) => s.name === "dev-browser")
		expect(playwrightSkill).toBeDefined()
		expect(agentBrowserSkill).toBeUndefined()
		expect(devBrowserSkill).toBeUndefined()
	})

	test("returns dev-browser skill when browserProvider is 'dev-browser'", () => {
		// given
		const options = { browserProvider: "dev-browser" as const }

		// when
		const skills = createBuiltinSkills(options)

		// then
		const skillNames = skills.map((skill) => skill.name)
		const devBrowserSkill = skills.find((skill) => skill.name === "dev-browser")
		const playwrightSkill = skills.find((skill) => skill.name === "playwright")
		const agentBrowserSkill = skills.find((skill) => skill.name === "agent-browser")
		expect(devBrowserSkill).toBeDefined()
		expect(devBrowserSkill?.description).toContain("Browser automation")
		expect(playwrightSkill).toBeUndefined()
		expect(agentBrowserSkill).toBeUndefined()
		expect(skillNames).not.toContain("playwright-cli")
		expect(skills.some((skill) => skill.allowedTools?.includes("Bash(playwright-cli:*)"))).toBe(false)
	})

	test("returns agent-browser skill when browserProvider is 'agent-browser'", () => {
		// given
		const options = { browserProvider: "agent-browser" as const }

		// when
		const skills = createBuiltinSkills(options)

		// then
		const agentBrowserSkill = skills.find((s) => s.name === "agent-browser")
		const playwrightSkill = skills.find((s) => s.name === "playwright")
		expect(agentBrowserSkill).toBeDefined()
		expect(agentBrowserSkill?.description).toContain("browser")
		expect(agentBrowserSkill?.allowedTools).toContain("Bash(agent-browser:*)")
		expect(agentBrowserSkill?.template).toContain("agent-browser")
		expect(playwrightSkill).toBeUndefined()
	})

	test("always includes frontend, git-master, review-work, shared skills, and runtime security skills", () => {
		// given - both provider options

		// when
		const defaultSkills = createBuiltinSkills()
		const agentBrowserSkills = createBuiltinSkills({ browserProvider: "agent-browser" })
		const devBrowserSkills = createBuiltinSkills({ browserProvider: "dev-browser" })

		// then
		for (const skills of [defaultSkills, agentBrowserSkills, devBrowserSkills]) {
			expect(skills.find((s) => s.name === "frontend")).toBeDefined()
			expect(skills.find((s) => s.name === "git-master")).toBeDefined()
			expect(skills.find((s) => s.name === "review-work")).toBeDefined()
			expect(skills.find((s) => s.name === "remove-ai-slops")).toBeDefined()
			expect(skills.find((s) => s.name === "init-deep")).toBeDefined()
			expect(skills.find((s) => s.name === "debugging")).toBeDefined()
			expect(skills.find((s) => s.name === "security-research")).toBeDefined()
			expect(skills.find((s) => s.name === "security-review")).toBeDefined()
			expect(skills.find((s) => s.name === "visual-qa")).toBeDefined()
		}
	})

	test("git-master skill keeps commit workflow phases in order", () => {
		// #given
		const skills = createBuiltinSkills()

		// #when
		const gitMaster = skills.find((skill) => skill.name === "git-master")

		// #then
		expect(gitMaster).toBeDefined()
	})

	test("returns exactly 10 skills regardless of provider", () => {
		// given

		// when
		const defaultSkills = createBuiltinSkills()
		const agentBrowserSkills = createBuiltinSkills({ browserProvider: "agent-browser" })
		const devBrowserSkills = createBuiltinSkills({ browserProvider: "dev-browser" })

		// then
		expect(defaultSkills).toHaveLength(10)
		expect(agentBrowserSkills).toHaveLength(10)
		expect(devBrowserSkills).toHaveLength(10)
	})

	test("should exclude playwright when it is in disabledSkills", () => {
		// #given
		const options = { disabledSkills: new Set(["playwright"]) }

		// #when
		const skills = createBuiltinSkills(options)

		// #then
		expect(skills.map((s) => s.name)).not.toContain("playwright")
		expect(skills.map((s) => s.name)).toContain("frontend")
		expect(skills.map((s) => s.name)).toContain("git-master")
		expect(skills.map((s) => s.name)).not.toContain("dev-browser")
		expect(skills.map((s) => s.name)).toContain("review-work")
		expect(skills.map((s) => s.name)).toContain("remove-ai-slops")
		expect(skills.map((s) => s.name)).toContain("init-deep")
		expect(skills.map((s) => s.name)).toContain("debugging")
		expect(skills.map((s) => s.name)).toContain("security-research")
		expect(skills.map((s) => s.name)).toContain("security-review")
		expect(skills.map((s) => s.name)).toContain("visual-qa")
		expect(skills.length).toBe(9)
	})

	test("should exclude multiple skills when they are in disabledSkills", () => {
		// #given
		const options = { disabledSkills: new Set(["playwright", "git-master"]) }

		// #when
		const skills = createBuiltinSkills(options)

		// #then
		expect(skills.map((s) => s.name)).not.toContain("playwright")
		expect(skills.map((s) => s.name)).not.toContain("git-master")
		expect(skills.map((s) => s.name)).toContain("frontend")
		expect(skills.map((s) => s.name)).not.toContain("dev-browser")
		expect(skills.map((s) => s.name)).toContain("review-work")
		expect(skills.map((s) => s.name)).toContain("remove-ai-slops")
		expect(skills.map((s) => s.name)).toContain("init-deep")
		expect(skills.map((s) => s.name)).toContain("debugging")
		expect(skills.map((s) => s.name)).toContain("security-research")
		expect(skills.map((s) => s.name)).toContain("security-review")
		expect(skills.map((s) => s.name)).toContain("visual-qa")
		expect(skills.length).toBe(8)
	})

	test("should return an empty array when all skills are disabled", () => {
		// #given
		const options = {
			disabledSkills: new Set([
				"playwright",
				"frontend",
				"git-master",
				"review-work",
				"remove-ai-slops",
				"init-deep",
				"debugging",
				"security-research",
				"security-review",
				"visual-qa",
			]),
		}

		// #when
		const skills = createBuiltinSkills(options)

		// #then
		expect(skills.length).toBe(0)
	})

	test("should return all 10 skills when disabledSkills set is empty", () => {
		// #given
		const options = { disabledSkills: new Set<string>() }

		// #when
		const skills = createBuiltinSkills(options)

		// #then
		expect(skills.length).toBe(10)
	})

	test("#given disabled_skills with debugging and visual-qa #when creating builtin skills #then both are filtered out", () => {
		// #given
		const options = { disabledSkills: new Set(["debugging", "visual-qa"]) }

		// #when
		const skills = createBuiltinSkills(options)
		const names = skills.map((s) => s.name)

		// #then
		expect(names).not.toContain("debugging")
		expect(names).not.toContain("visual-qa")

		const allSkills = createBuiltinSkills()
		expect(allSkills.map((s) => s.name)).toContain("debugging")
		expect(allSkills.map((s) => s.name)).toContain("visual-qa")
	})

	test("init-deep skill has correct structure", () => {
		// #given - default options

		// #when
		const skills = createBuiltinSkills()
		const initDeep = skills.find((s) => s.name === "init-deep")

		// #then
		expect(initDeep).toBeDefined()
		expect(initDeep?.description).toContain("hierarchical AGENTS.md")
		expect(initDeep?.argumentHint).toBe("[--create-new] [--max-depth=N]")
	})

	test("debugging skill is available from shared template", () => {
		// #given - default options

		// #when
		const skills = createBuiltinSkills()
		const debugging = skills.find((skill) => skill.name === "debugging")

		// #then
		expect(debugging).toBeDefined()
		expect(debugging?.description).toBeDefined()
		expect(debugging?.description.toLowerCase()).toContain("debugging")
	})

	test("review-work skill has correct structure", () => {
		// #given - default options

		// #when
		const skills = createBuiltinSkills()
		const reviewWork = skills.find((s) => s.name === "review-work")

		// #then
		expect(reviewWork).toBeDefined()
		expect(reviewWork?.description).toContain("review")
	})

	test("review-work skill explains Codex tool compatibility before OpenCode orchestration examples", () => {
		// #given
		const skills = createBuiltinSkills()

		// #when
		const reviewWork = skills.find((s) => s.name === "review-work")
		const reviewWorkTemplate = reviewWork?.template ?? ""
		const compatibilityIndex = reviewWorkTemplate.indexOf("## Codex Harness Tool Compatibility")
		const opencodeExampleIndex = reviewWorkTemplate.search(/\b(?:background_output|team_[a-z_]+|task)\s*\(/)

		// #then
		expect(compatibilityIndex >= 0).toBe(true)
		expect(compatibilityIndex < opencodeExampleIndex).toBe(true)
	})

	test("remove-ai-slops skill has correct structure", () => {
		// #given - default options

		// #when
		const skills = createBuiltinSkills()
		const removeAiSlops = skills.find((s) => s.name === "remove-ai-slops")

		// #then
		expect(removeAiSlops).toBeDefined()
		expect(removeAiSlops?.description).toContain("AI-generated code smells")
	})

	test("security-research skill has correct structure", () => {
		// #given - default options

		// #when
		const skills = createBuiltinSkills()
		const securityResearch = skills.find((skill) => skill.name === "security-research")

		// #then
		expect(securityResearch?.description).toContain("security research")
	})

	test("security-review skill remains a runtime alias for security-research", () => {
		// #given - default options

		// #when
		const skills = createBuiltinSkills()
		const securityReview = skills.find((skill) => skill.name === "security-review")
		const securityResearch = skills.find((skill) => skill.name === "security-research")

		// #then
		expect(securityReview?.description).toContain("Alias for security-research")
		expect(securityReview?.description).toContain("/security-review")
		expect(securityReview?.template).toBe(securityResearch?.template)
	})

	test("returns playwright-cli skill when browserProvider is 'playwright-cli'", () => {
		// given
		const options = { browserProvider: "playwright-cli" as const }

		// when
		const skills = createBuiltinSkills(options)

		// then
		const playwrightSkill = skills.find((s) => s.name === "playwright")
		const agentBrowserSkill = skills.find((s) => s.name === "agent-browser")
		expect(playwrightSkill).toBeDefined()
		expect(playwrightSkill?.description).toContain("browser")
		expect(playwrightSkill?.allowedTools).toContain("Bash(playwright-cli:*)")
		expect(playwrightSkill?.mcpConfig).toBeUndefined()
		expect(agentBrowserSkill).toBeUndefined()
	})
})

import { describe, test, expect } from "bun:test"
import { createBuiltinSkills } from "./skills"

describe("createBuiltinSkills", () => {
	test("returns playwright skill by default", () => {
		// given - no options (default)

		// when
		const skills = createBuiltinSkills()

		// then
		const browserSkill = skills.find((s) => s.name === "playwright")
		expect(browserSkill).toBeDefined()
		expect(browserSkill!.description).toContain("browser")
		expect(browserSkill!.mcpConfig).toHaveProperty("playwright")
	})

	test("returns playwright skill when browserProvider is 'playwright'", () => {
		// given
		const options = { browserProvider: "playwright" as const }

		// when
		const skills = createBuiltinSkills(options)

		// then
		const playwrightSkill = skills.find((s) => s.name === "playwright")
		const agentBrowserSkill = skills.find((s) => s.name === "agent-browser")
		expect(playwrightSkill).toBeDefined()
		expect(agentBrowserSkill).toBeUndefined()
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
		expect(agentBrowserSkill!.description).toContain("browser")
		expect(agentBrowserSkill!.allowedTools).toContain("Bash(agent-browser:*)")
		expect(agentBrowserSkill!.template).toContain("agent-browser")
		expect(playwrightSkill).toBeUndefined()
	})

	test("agent-browser skill template is inlined (not loaded from file)", () => {
		// given
		const options = { browserProvider: "agent-browser" as const }

		// when
		const skills = createBuiltinSkills(options)
		const agentBrowserSkill = skills.find((s) => s.name === "agent-browser")

		// then - template should contain substantial content (inlined, not fallback)
		expect(agentBrowserSkill!.template).toContain("## Quick start")
		expect(agentBrowserSkill!.template).toContain("## Commands")
		expect(agentBrowserSkill!.template).toContain("agent-browser open")
		expect(agentBrowserSkill!.template).toContain("agent-browser snapshot")
	})

	test("always includes frontend-ui-ux, git-master, and dsl skills", () => {
		// given - both provider options

		// when
		const defaultSkills = createBuiltinSkills()
		const agentBrowserSkills = createBuiltinSkills({ browserProvider: "agent-browser" })

		// then
		for (const skills of [defaultSkills, agentBrowserSkills]) {
			expect(skills.find((s) => s.name === "frontend-ui-ux")).toBeDefined()
			expect(skills.find((s) => s.name === "git-master")).toBeDefined()
			expect(skills.find((s) => s.name === "dsl-core")).toBeDefined()
			expect(skills.find((s) => s.name === "dsl-grammar")).toBeDefined()
			expect(skills.find((s) => s.name === "dsl-codegen")).toBeDefined()
			expect(skills.find((s) => s.name === "dsl-metamodel")).toBeDefined()
			expect(skills.find((s) => s.name === "dsl-tooling")).toBeDefined()
		}
	})

	test("returns exactly 42 skills regardless of provider", () => {
		// given

		// when
		const defaultSkills = createBuiltinSkills()
		const agentBrowserSkills = createBuiltinSkills({ browserProvider: "agent-browser" })

		// then
		expect(defaultSkills).toHaveLength(42)
		expect(agentBrowserSkills).toHaveLength(42)
	})

	test("should exclude playwright when it is in disabledSkills", () => {
		// #given
		const options = { disabledSkills: new Set(["playwright"]) }

		// #when
		const skills = createBuiltinSkills(options)

		// #then
		expect(skills.map((s) => s.name)).not.toContain("playwright")
		expect(skills.map((s) => s.name)).toContain("frontend-ui-ux")
		expect(skills.map((s) => s.name)).toContain("git-master")
		expect(skills.map((s) => s.name)).toContain("dev-browser")
		expect(skills.map((s) => s.name)).toContain("dsl-core")
		expect(skills.length).toBe(40)
	})

	test("should exclude multiple skills when they are in disabledSkills", () => {
		// #given
		const options = { disabledSkills: new Set(["playwright", "git-master"]) }

		// #when
		const skills = createBuiltinSkills(options)

		// #then
		expect(skills.map((s) => s.name)).not.toContain("playwright")
		expect(skills.map((s) => s.name)).not.toContain("git-master")
		expect(skills.map((s) => s.name)).toContain("frontend-ui-ux")
		expect(skills.map((s) => s.name)).toContain("dev-browser")
		expect(skills.map((s) => s.name)).toContain("dsl-core")
		expect(skills.length).toBe(39)
	})

	test("should return an empty array when all skills are disabled", () => {
		// #given
		const options = {
			disabledSkills: new Set(["playwright", "frontend-ui-ux", "git-master", "dev-browser", "dsl-core", "dsl-grammar", "dsl-codegen", "dsl-metamodel", "dsl-tooling", "dsl-textx-ecosystem", "dsl-pyecore-advanced", "dsl-model-transformation", "dsl-testing", "dsl-validation", "dsl-composition", "eu-horizon", "academic-review", "deliverable-writing", "project-management", "technical-lead", "academic-writing", "research-methodology", "literature-review", "grant-writing", "scientific-presentation", "data-management-plan", "ip-exploitation", "document-reader", "crypto-market-analysis", "crypto-trading", "crypto-onchain", "security-core", "security-secrets", "security-sast", "security-dast", "security-dependencies", "security-api", "security-crypto", "security-infra", "security-review", "tdd-enforcer"]),
		}

		// #when
		const skills = createBuiltinSkills(options)

		// #then
		expect(skills.length).toBe(0)
	})

	test("should return all skills when disabledSkills set is empty", () => {
		// #given
		const options = { disabledSkills: new Set<string>() }

		// #when
		const skills = createBuiltinSkills(options)

		// #then
		expect(skills.length).toBe(41)
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
		expect(playwrightSkill!.description).toContain("browser")
		expect(playwrightSkill!.allowedTools).toContain("Bash(playwright-cli:*)")
		expect(playwrightSkill!.mcpConfig).toBeUndefined()
		expect(agentBrowserSkill).toBeUndefined()
	})

	test("playwright-cli skill template contains CLI commands", () => {
		// given
		const options = { browserProvider: "playwright-cli" as const }

		// when
		const skills = createBuiltinSkills(options)
		const skill = skills.find((s) => s.name === "playwright")

		// then
		expect(skill!.template).toContain("playwright-cli open")
		expect(skill!.template).toContain("playwright-cli snapshot")
		expect(skill!.template).toContain("playwright-cli click")
	})
})

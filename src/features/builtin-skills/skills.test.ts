/// <reference path="../../../bun-test.d.ts" />

import { describe, test, expect } from "bun:test"
import { createBuiltinSkills } from "./skills"

const ALWAYS_ON_NON_BROWSER_SKILLS = [
	"frontend-ui-ux",
	"git-master",
	"review-work",
	"remove-ai-slops",
	"init-deep",
	"debugging",
	"security-research",
	"security-review",
	"visual-qa",
	"locale-aware-writing",
	"official-document-writing",
	"creative-writing",
	"law-policy-writing",
	"product-definition-writing",
]

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

	test("agent-browser skill template is inlined (not loaded from file)", () => {
		// given
		const options = { browserProvider: "agent-browser" as const }

		// when
		const skills = createBuiltinSkills(options)
		const agentBrowserSkill = skills.find((s) => s.name === "agent-browser")

		// then - template should contain substantial content (inlined, not fallback)
		expect(agentBrowserSkill?.template).toContain("## Quick start")
		expect(agentBrowserSkill?.template).toContain("## Commands")
		expect(agentBrowserSkill?.template).toContain("agent-browser open")
		expect(agentBrowserSkill?.template).toContain("agent-browser snapshot")
	})

	test("always includes core, shared, security, visual QA, and non-coding writing skills", () => {
		// given - both provider options

		// when
		const defaultSkills = createBuiltinSkills()
		const agentBrowserSkills = createBuiltinSkills({ browserProvider: "agent-browser" })
		const devBrowserSkills = createBuiltinSkills({ browserProvider: "dev-browser" })

		// then
		for (const skills of [defaultSkills, agentBrowserSkills, devBrowserSkills]) {
			for (const skillName of ALWAYS_ON_NON_BROWSER_SKILLS) {
				expect(skills.find((s) => s.name === skillName)).toBeDefined()
			}
		}
	})

	test("returns exactly 15 skills regardless of provider", () => {
		// given

		// when
		const defaultSkills = createBuiltinSkills()
		const agentBrowserSkills = createBuiltinSkills({ browserProvider: "agent-browser" })
		const devBrowserSkills = createBuiltinSkills({ browserProvider: "dev-browser" })

		// then
		expect(defaultSkills).toHaveLength(15)
		expect(agentBrowserSkills).toHaveLength(15)
		expect(devBrowserSkills).toHaveLength(15)
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
		expect(skills.map((s) => s.name)).not.toContain("dev-browser")
		expect(skills.map((s) => s.name)).toContain("review-work")
		expect(skills.map((s) => s.name)).toContain("remove-ai-slops")
		expect(skills.map((s) => s.name)).toContain("init-deep")
		expect(skills.map((s) => s.name)).toContain("debugging")
		expect(skills.map((s) => s.name)).toContain("security-research")
		expect(skills.map((s) => s.name)).toContain("security-review")
		expect(skills.map((s) => s.name)).toContain("visual-qa")
		expect(skills.map((s) => s.name)).toContain("locale-aware-writing")
		expect(skills.length).toBe(14)
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
		expect(skills.map((s) => s.name)).not.toContain("dev-browser")
		expect(skills.map((s) => s.name)).toContain("review-work")
		expect(skills.map((s) => s.name)).toContain("remove-ai-slops")
		expect(skills.map((s) => s.name)).toContain("init-deep")
		expect(skills.map((s) => s.name)).toContain("debugging")
		expect(skills.map((s) => s.name)).toContain("security-research")
		expect(skills.map((s) => s.name)).toContain("security-review")
		expect(skills.map((s) => s.name)).toContain("visual-qa")
		expect(skills.map((s) => s.name)).toContain("official-document-writing")
		expect(skills.length).toBe(13)
	})

	test("should return an empty array when all skills are disabled", () => {
		// #given
		const options = { disabledSkills: new Set(["playwright", ...ALWAYS_ON_NON_BROWSER_SKILLS]) }

		// #when
		const skills = createBuiltinSkills(options)

		// #then
		expect(skills.length).toBe(0)
	})

	test("should return all 15 skills when disabledSkills set is empty", () => {
		// #given
		const options = { disabledSkills: new Set<string>() }

		// #when
		const skills = createBuiltinSkills(options)

		// #then
		expect(skills.length).toBe(15)
	})

	test("init-deep skill has correct structure", () => {
		// #given - default options

		// #when
		const skills = createBuiltinSkills()
		const initDeep = skills.find((s) => s.name === "init-deep")

		// #then
		expect(initDeep).toBeDefined()
		expect(initDeep!.description).toContain("hierarchical AGENTS.md")
		expect(initDeep!.argumentHint).toBe("[--create-new] [--max-depth=N]")
		expect(initDeep!.template).toContain("Generate hierarchical AGENTS.md files")
		expect(initDeep!.template).toContain("Discovery + Analysis")
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
		expect(debugging?.template).toContain("hypothesis-driven debugger")
		expect(debugging?.template).toContain("READ THE REFERENCES")
	})

	test("review-work skill has correct structure", () => {
		// #given - default options

		// #when
		const skills = createBuiltinSkills()
		const reviewWork = skills.find((s) => s.name === "review-work")

		// #then
		expect(reviewWork).toBeDefined()
		expect(reviewWork?.description).toContain("review")
		expect(reviewWork?.template).toContain("5-Agent Parallel Review Orchestrator")
		expect(reviewWork?.template).toContain("Goal & Constraint Verification")
		expect(reviewWork?.template).toContain("QA")
		expect(reviewWork?.template).toContain("Code Quality")
		expect(reviewWork?.template).toContain("Security")
		expect(reviewWork?.template).toContain("Context Mining")
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
		expect(removeAiSlops!.description).toContain("AI-generated code smells")
		expect(removeAiSlops!.template).toContain("Remove AI Slops Skill")
		expect(removeAiSlops!.template).toContain("$omo:remove-ai-slops")
	})

	test("security-research skill has correct structure", () => {
		// #given - default options

		// #when
		const skills = createBuiltinSkills()
		const securityResearch = skills.find((skill) => skill.name === "security-research")

		// #then
		expect(securityResearch?.description).toContain("security research")
		expect(securityResearch?.template).toContain("Security Research - Team Mode Vulnerability Audit")
		expect(securityResearch?.template).toContain('name: "security-research"')
		expect(securityResearch?.template).toContain("Security Research Result")
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

	test("non-coding writing skills have correct boundaries", () => {
		// #given - default options

		// #when
		const skills = createBuiltinSkills()
		const localeAware = skills.find((s) => s.name === "locale-aware-writing")
		const officialDocument = skills.find((s) => s.name === "official-document-writing")
		const creativeWriting = skills.find((s) => s.name === "creative-writing")
		const lawPolicy = skills.find((s) => s.name === "law-policy-writing")
		const productDefinition = skills.find((s) => s.name === "product-definition-writing")

		// #then
		expect(localeAware).toBeDefined()
		expect(localeAware!.template).toContain("document culture")
		expect(officialDocument).toBeDefined()
		expect(officialDocument!.template).toContain("official correspondence")
		expect(creativeWriting).toBeDefined()
		expect(creativeWriting!.template).toContain("voice")
		expect(lawPolicy).toBeDefined()
		expect(lawPolicy!.template).toContain("Out of Scope")
		expect(lawPolicy!.template).toContain("Client-specific legal advice")
		expect(productDefinition).toBeDefined()
		expect(productDefinition!.template).toContain("acceptance criteria")
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

	test("playwright-cli skill template contains CLI commands", () => {
		// given
		const options = { browserProvider: "playwright-cli" as const }

		// when
		const skills = createBuiltinSkills(options)
		const skill = skills.find((s) => s.name === "playwright")

		// then
		expect(skill?.template).toContain("playwright-cli open")
		expect(skill?.template).toContain("playwright-cli snapshot")
		expect(skill?.template).toContain("playwright-cli click")
	})
})

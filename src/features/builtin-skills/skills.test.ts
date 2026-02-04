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

	test("always includes frontend-ui-ux and git-master skills", () => {
		// given - both provider options

		// when
		const defaultSkills = createBuiltinSkills()
		const agentBrowserSkills = createBuiltinSkills({ browserProvider: "agent-browser" })

		// then
		for (const skills of [defaultSkills, agentBrowserSkills]) {
			expect(skills.find((s) => s.name === "frontend-ui-ux")).toBeDefined()
			expect(skills.find((s) => s.name === "git-master")).toBeDefined()
		}
	})

	test("includes brainstorming skill", () => {
		// #given
		const skills = createBuiltinSkills()

		// #when
		const names = skills.map((skill) => skill.name)

		// #then
		expect(names).toContain("brainstorming")
	})

	test("includes creating-changes skill", () => {
		// #given
		const skills = createBuiltinSkills()

		// #when
		const names = skills.map((skill) => skill.name)

		// #then
		expect(names).toContain("creating-changes")
	})

	test("includes execution and completion skills", () => {
		// #given
		const skills = createBuiltinSkills()

		// #when
		const names = skills.map((skill) => skill.name)

		// #then
		const expected = [
			"tdd",
			"test-driven-development",
			"systematic-debugging",
			"requesting-code-review",
			"receiving-code-review",
			"collaborating-with-codex",
			"collaborating-with-gemini",
			"verification-before-completion",
			"using-git-worktrees",
			"dispatching-parallel-agents",
			"subagent-driven-development",
			"finishing-a-development-branch",
			"archiving-changes",
			"writing-skills",
			"wave-parallel-execution",
			"executing-plans",
		]

		for (const name of expected) {
			expect(names).toContain(name)
		}
	})
})

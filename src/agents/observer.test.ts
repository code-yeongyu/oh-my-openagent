import { describe, test, expect } from "bun:test"
import { createObserverAgent, OBSERVER_PROMPT_METADATA } from "./observer"

describe("Observer agent", () => {
	test("should export OBSERVER_PROMPT_METADATA with correct category", () => {
		// #given / #when / #then
		expect(OBSERVER_PROMPT_METADATA.category).toBe("utility")
	})

	test("should export OBSERVER_PROMPT_METADATA with CHEAP cost", () => {
		// #given / #when / #then
		expect(OBSERVER_PROMPT_METADATA.cost).toBe("CHEAP")
	})

	test("should export OBSERVER_PROMPT_METADATA with pattern detection triggers", () => {
		// #given / #when / #then
		expect(OBSERVER_PROMPT_METADATA.triggers).toBeDefined()
		expect(OBSERVER_PROMPT_METADATA.triggers!.length).toBeGreaterThan(0)
	})

	test("should create agent with default model", () => {
		// #given
		const defaultModel = "Antigravity-Gemini/gemini-3-flash"

		// #when
		const agent = createObserverAgent(defaultModel)

		// #then
		expect(agent.model).toBe(defaultModel)
	})

	test("should create agent with subagent mode", () => {
		// #given / #when
		const agent = createObserverAgent("Antigravity-Gemini/gemini-3-flash")

		// #then
		expect(agent.mode).toBe("subagent")
	})

	test("should create agent with read-only restrictions", () => {
		// #given / #when
		const agent = createObserverAgent("Antigravity-Gemini/gemini-3-flash")

		// #then - uses permission format from createAgentToolRestrictions
		expect(agent.permission).toBeDefined()
		expect(agent.permission?.["edit"]).toBe("deny")
	})

	test("should create agent with low temperature", () => {
		// #given / #when
		const agent = createObserverAgent("Antigravity-Gemini/gemini-3-flash")

		// #then
		expect(agent.temperature).toBe(0.1)
	})

	test("should include pattern detection in prompt", () => {
		// #given
		const agent = createObserverAgent("Antigravity-Gemini/gemini-3-flash")
		const prompt = agent.prompt ?? ""

		// #when / #then
		expect(prompt.toLowerCase()).toContain("pattern")
		expect(prompt.toLowerCase()).toContain("observation")
	})

	test("should include confidence calculation in prompt", () => {
		// #given
		const agent = createObserverAgent("Antigravity-Gemini/gemini-3-flash")
		const prompt = agent.prompt ?? ""

		// #when / #then
		expect(prompt.toLowerCase()).toContain("confidence")
	})

	test("should include instinct creation guidelines in prompt", () => {
		// #given
		const agent = createObserverAgent("Antigravity-Gemini/gemini-3-flash")
		const prompt = agent.prompt ?? ""

		// #when / #then
		expect(prompt.toLowerCase()).toContain("instinct")
	})

	test("should have proper description", () => {
		// #given / #when
		const agent = createObserverAgent("Antigravity-Gemini/gemini-3-flash")

		// #then
		expect(agent.description).toBeDefined()
		expect(agent.description!.toLowerCase()).toContain("background")
		expect(agent.description!.toLowerCase()).toContain("pattern")
	})
})

import { describe, expect, test } from "bun:test"

import { fuzzyMatchModel } from "./model-availability"

describe("fuzzyMatchModel", () => {
	test("#given kimi dash and dot variants #when matching #then normalizes the version separator symmetrically", () => {
		const available = new Set(["moonshot/kimi-k2-6"])
		const result = fuzzyMatchModel("kimi-k2.6", available, ["moonshot"])
		expect(result).toBe("moonshot/kimi-k2-6")
	})

	test("#given glm dash and dot variants #when matching #then normalizes the version separator symmetrically", () => {
		const available = new Set(["zai/glm-5.1"])
		const result = fuzzyMatchModel("glm-5-1", available, ["zai"])
		expect(result).toBe("zai/glm-5.1")
	})

	test("#given gpt dash and dot variants #when matching #then normalizes the version separator symmetrically", () => {
		const available = new Set(["openai/gpt-5-4"])
		const result = fuzzyMatchModel("gpt-5.4", available, ["openai"])
		expect(result).toBe("openai/gpt-5-4")
	})

	// #8051: `opencode/claude-opus-5` (22 chars) used to beat `claude-sdk-oauth/claude-opus-5` (30 chars)
	// purely because the provider name is shorter. Provider preference belongs to the rung's own
	// provider order; the length tie-break may only look at the model id.
	test("#given two providers with the same exact model id #when the rung lists both #then the rung's provider order decides, not provider name length", () => {
		const available = new Set(["opencode/claude-opus-5", "claude-sdk-oauth/claude-opus-5"])

		expect(fuzzyMatchModel("claude-opus-5", available, ["claude-sdk-oauth", "opencode"])).toBe("claude-sdk-oauth/claude-opus-5")
		expect(fuzzyMatchModel("claude-opus-5", available, ["opencode", "claude-sdk-oauth"])).toBe("opencode/claude-opus-5")
	})

	test("#given two providers with the same exact model id #when no provider list is given #then the longer provider name is not penalized", () => {
		// The set lists the long-named provider first; only a provider-name-length tie-break can flip it.
		const available = new Set(["claude-sdk-oauth/claude-opus-5", "opencode/claude-opus-5"])

		expect(fuzzyMatchModel("claude-opus-5", available)).toBe("claude-sdk-oauth/claude-opus-5")
	})

	test("#given substring matches with different model ids #when tie-breaking #then the shortest MODEL id wins even behind a longer provider name", () => {
		// Total string length would pick `opencode/claude-opus-5-2025` (27) over
		// `claude-sdk-oauth/claude-opus-5` (30); the closer model id is the 13-char one.
		const available = new Set(["opencode/claude-opus-5-2025", "claude-sdk-oauth/claude-opus-5"])

		expect(fuzzyMatchModel("claude-opus", available)).toBe("claude-sdk-oauth/claude-opus-5")
	})
})

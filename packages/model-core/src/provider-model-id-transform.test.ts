import { describe, expect, test } from "bun:test"

import {
	transformModelForProvider,
	transformModelForProviderDisplay,
} from "./provider-model-id-transform"

describe("provider model ID transforms", () => {
	test("keeps separate Anthropic API and display behavior", () => {
		// #given an Anthropic model ID in config-display form
		const provider = "anthropic"
		const model = "claude-opus-4-7"

		// #when both model-core transform variants are called
		const apiResult = transformModelForProvider(provider, model)
		const displayResult = transformModelForProviderDisplay(provider, model)

		// #then API calls use dotted Anthropic versions while display keeps hyphens
		expect(apiResult).toBe("claude-opus-4.7")
		expect(displayResult).toBe("claude-opus-4-7")
	})

	test("produces identical results for non-Anthropic providers", () => {
		// #given non-Anthropic provider/model pairs
		const scenarios = [
			{ provider: "openai", model: "gpt-4o" },
			{ provider: "google", model: "gemini-2.5-pro" },
			{ provider: "github-copilot", model: "gemini-3-flash" },
			{ provider: "vercel", model: "claude-opus-4-7" },
		] as const

		for (const scenario of scenarios) {
			// #when both transform variants are called
			const apiResult = transformModelForProvider(
				scenario.provider,
				scenario.model,
			)
			const displayResult = transformModelForProviderDisplay(
				scenario.provider,
				scenario.model,
			)

			// #then the variants match outside the direct Anthropic provider branch
			expect(displayResult).toBe(apiResult)
		}
	})
})

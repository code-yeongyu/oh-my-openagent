import { describe, expect, test } from "bun:test"

import {
	transformModelForProvider,
	transformModelForProviderDisplay,
} from "./provider-model-id-transform"

describe("provider model ID transforms", () => {
	test("preserves hyphenated Anthropic IDs for direct API calls", () => {
		// #given Anthropic model IDs in config-display form
		const provider = "anthropic"
		const models = ["claude-haiku-4-5", "claude-opus-4-7"] as const

		for (const model of models) {
			// #when both model-core transform variants are called
			const apiResult = transformModelForProvider(provider, model)
			const displayResult = transformModelForProviderDisplay(provider, model)

			// #then direct Anthropic calls keep the strict provider model ID
			expect(apiResult).toBe(model)
			expect(displayResult).toBe(model)
		}
	})

	test("keeps dotted Claude versions for gateway providers", () => {
		// #given gateway providers that expect Claude version aliases
		const scenarios = [
			{
				provider: "github-copilot",
				model: "claude-haiku-4-5",
				expected: "claude-haiku-4.5",
			},
			{
				provider: "github-copilot",
				model: "claude-opus-4-7",
				expected: "claude-opus-4.7",
			},
			{
				provider: "vercel",
				model: "claude-haiku-4-5",
				expected: "anthropic/claude-haiku-4.5",
			},
			{
				provider: "vercel",
				model: "anthropic/claude-opus-4-7",
				expected: "anthropic/claude-opus-4.7",
			},
		] as const

		for (const scenario of scenarios) {
			// #when a gateway transform is applied
			const result = transformModelForProvider(scenario.provider, scenario.model)

			// #then the gateway receives its dotted Claude version form
			expect(result).toBe(scenario.expected)
		}
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

describe("openrouter provider model ID transforms", () => {
	test("infers anthropic sub-provider for claude models", () => {
		// #given an OpenRouter provider with a claude model
		const provider = "openrouter"
		const model = "claude-opus-4-7"

		// #when transforming the model ID
		const result = transformModelForProvider(provider, model)

		// #then the model is prefixed with anthropic/
		expect(result).toBe("anthropic/claude-opus-4-7")
	})

	test("infers openai sub-provider for gpt models", () => {
		// #given an OpenRouter provider with a gpt model
		const provider = "openrouter"
		const model = "gpt-5.5"

		// #when transforming the model ID
		const result = transformModelForProvider(provider, model)

		// #then the model is prefixed with openai/
		expect(result).toBe("openai/gpt-5.5")
	})

	test("passes through model IDs that already contain a slash", () => {
		// #given an OpenRouter provider with a fully-qualified model ID
		const provider = "openrouter"
		const model = "anthropic/claude-opus-4-7"

		// #when transforming the model ID
		const result = transformModelForProvider(provider, model)

		// #then the model is returned unchanged
		expect(result).toBe("anthropic/claude-opus-4-7")
	})

	test("infers google sub-provider for gemini models", () => {
		// #given an OpenRouter provider with a gemini model
		const provider = "openrouter"
		const model = "gemini-3.1-pro"

		// #when transforming the model ID
		const result = transformModelForProvider(provider, model)

		// #then the model is prefixed with google/
		expect(result).toBe("google/gemini-3.1-pro")
	})

	test("returns model unchanged when sub-provider cannot be inferred", () => {
		// #given an OpenRouter provider with an unknown model prefix
		const provider = "openrouter"
		const model = "unknown-model-xyz"

		// #when transforming the model ID
		const result = transformModelForProvider(provider, model)

		// #then the model is returned as-is
		expect(result).toBe("unknown-model-xyz")
	})
})

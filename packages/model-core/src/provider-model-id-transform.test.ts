import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS } from "./registry";
import { describe, expect, test } from "bun:test"

import {
	transformModelForProvider,
	transformModelForProviderDisplay,
} from "./provider-model-id-transform"

describe("provider model ID transforms", () => {
	test("preserves hyphenated Anthropic IDs for direct API calls", () => {
		// #given Anthropic model IDs in config-display form
		const provider = SUPPORTED_PROVIDERS.ANTHROPIC
		const models = [SUPPORTED_MODELS.CLAUDE_HAIKU_4_5, SUPPORTED_MODELS.CLAUDE_OPUS_4_7] as const

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
				provider: SUPPORTED_PROVIDERS.GITHUB_COPILOT,
				model: SUPPORTED_MODELS.CLAUDE_HAIKU_4_5,
				expected: "claude-haiku-4.5",
			},
			{
				provider: SUPPORTED_PROVIDERS.GITHUB_COPILOT,
				model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7,
				expected: "claude-opus-4.7",
			},
			{
				provider: SUPPORTED_PROVIDERS.VERCEL,
				model: SUPPORTED_MODELS.CLAUDE_HAIKU_4_5,
				expected: "anthropic/claude-haiku-4.5",
			},
			{
				provider: SUPPORTED_PROVIDERS.VERCEL,
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
			{ provider: SUPPORTED_PROVIDERS.OPENAI, model: SUPPORTED_MODELS.GPT_4O },
			{ provider: SUPPORTED_PROVIDERS.GOOGLE, model: "gemini-2.5-pro" },
			{ provider: SUPPORTED_PROVIDERS.GITHUB_COPILOT, model: SUPPORTED_MODELS.GEMINI_3_FLASH },
			{ provider: SUPPORTED_PROVIDERS.VERCEL, model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 },
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

import { describe, expect, test } from "bun:test"

import {
	buildFallbackChainFromModels,
	parseFallbackModelEntry,
} from "./fallback-chain-from-models"

describe("fallback chain from model strings", () => {
	test("#given a pipe-routed fallback string #when parsed #then all providers share the same routed model", () => {
		// #given
		const fallback = "omniRoute|9router/openai/gpt-5.5 high"

		// #when
		const entry = parseFallbackModelEntry(fallback, undefined)

		// #then
		expect(entry).toEqual({
			providers: ["omniRoute", "9router"],
			model: "openai/gpt-5.5",
			variant: "high",
		})
	})

	test("#given mixed fallback models with a pipe object #when chain is built #then object settings attach to the normalized route", () => {
		// #given
		const fallbackModels = [
			"github-copilot/claude-opus-4-7(max)",
			{ model: "omniRoute|9router/openai/gpt-5.5", variant: "medium", temperature: 0.2 },
		]

		// #when
		const chain = buildFallbackChainFromModels(fallbackModels, undefined)

		// #then
		expect(chain).toEqual([
			{ providers: ["github-copilot"], model: "claude-opus-4-7", variant: "max" },
			{
				providers: ["omniRoute", "9router"],
				model: "openai/gpt-5.5",
				variant: "medium",
				temperature: 0.2,
			},
		])
	})

	test("#given a malformed pipe fallback #when parsed #then it is rejected without throwing", () => {
		// #given
		const fallback = "omniRoute|/gpt-5.5"

		// #when
		const entry = parseFallbackModelEntry(fallback, undefined)

		// #then
		expect(entry).toBeUndefined()
	})
})

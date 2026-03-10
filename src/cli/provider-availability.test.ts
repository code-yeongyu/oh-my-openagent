import { describe, it, expect } from "bun:test"

import { isProviderAvailable, toProviderAvailability } from "./provider-availability"
import type { ProviderAvailability } from "./model-fallback-types"

function makeAvailability(overrides: Partial<ProviderAvailability> = {}): ProviderAvailability {
	return {
		native: {
			claude: false,
			openai: false,
			gemini: false,
		},
		opencodeZen: false,
		copilot: false,
		zai: false,
		kimiForCoding: false,
		isMaxPlan: false,
		...overrides,
	}
}

describe("isProviderAvailable", () => {
	describe("ollama provider", () => {
		describe("#given availability with ollama: true", () => {
			describe("#when isProviderAvailable is called with ollama", () => {
				it("#then returns true", () => {
					const availability = makeAvailability({ ollama: true })
					expect(isProviderAvailable("ollama", availability)).toBe(true)
				})
			})
		})

		describe("#given availability with ollama: false", () => {
			describe("#when isProviderAvailable is called with ollama", () => {
				it("#then returns false", () => {
					const availability = makeAvailability({ ollama: false })
					expect(isProviderAvailable("ollama", availability)).toBe(false)
				})
			})
		})

		describe("#given availability with ollama: undefined", () => {
			describe("#when isProviderAvailable is called with ollama", () => {
				it("#then returns false", () => {
					const availability = makeAvailability({ ollama: undefined })
					expect(isProviderAvailable("ollama", availability)).toBe(false)
				})
			})
		})
	})
})

describe("toProviderAvailability", () => {
	describe("#given an InstallConfig with hasOllama: true", () => {
		describe("#when toProviderAvailability is called", () => {
			it("#then returns object with ollama: true", () => {
				const result = toProviderAvailability({
					hasClaude: false,
					isMax20: false,
					hasOpenAI: false,
					hasGemini: false,
					hasCopilot: false,
					hasOpencodeZen: false,
					hasZaiCodingPlan: false,
					hasKimiForCoding: false,
					hasOllama: true,
				})
				expect(result.ollama).toBe(true)
			})
		})
	})

	describe("#given an InstallConfig with hasOllama: false", () => {
		describe("#when toProviderAvailability is called", () => {
			it("#then returns object with ollama: false", () => {
				const result = toProviderAvailability({
					hasClaude: false,
					isMax20: false,
					hasOpenAI: false,
					hasGemini: false,
					hasCopilot: false,
					hasOpencodeZen: false,
					hasZaiCodingPlan: false,
					hasKimiForCoding: false,
					hasOllama: false,
				})
				expect(result.ollama).toBe(false)
			})
		})
	})

	describe("#given an InstallConfig with hasOllama: undefined", () => {
		describe("#when toProviderAvailability is called", () => {
			it("#then returns object with ollama: false", () => {
				const result = toProviderAvailability({
					hasClaude: false,
					isMax20: false,
					hasOpenAI: false,
					hasGemini: false,
					hasCopilot: false,
					hasOpencodeZen: false,
					hasZaiCodingPlan: false,
					hasKimiForCoding: false,
				})
				expect(result.ollama).toBe(false)
			})
		})
	})
})

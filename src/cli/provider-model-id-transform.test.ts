declare const require: (name: string) => any
const { beforeAll, beforeEach, describe, expect, mock, test } = require("bun:test")

let providerModelsCache: { models: Record<string, Array<string | { id?: string }>> } | null = null

mock.module("../shared/connected-providers-cache", () => ({
	readProviderModelsCache: () => providerModelsCache,
}))

let transformModelForProvider: (provider: string, model: string) => string

beforeAll(async () => {
	;({ transformModelForProvider } = await import("./provider-model-id-transform"))
})

describe("transformModelForProvider", () => {
	beforeEach(() => {
		providerModelsCache = null
	})

	describe("provider-model cache", () => {
		test("resolves github-copilot claude dot-notation dynamically from cache", () => {
			providerModelsCache = {
				models: {
					"github-copilot": [{ id: "claude-opus-4.6" }],
				},
			}

			const result = transformModelForProvider("github-copilot", "claude-opus-4-6")

			expect(result).toBe("claude-opus-4.6")
		})

		test("resolves google preview variants dynamically from cache", () => {
			providerModelsCache = {
				models: {
					google: [{ id: "gemini-3.1-pro-preview" }, { id: "gemini-3-flash-preview" }],
				},
			}

			expect(transformModelForProvider("google", "gemini-3.1-pro")).toBe("gemini-3.1-pro-preview")
			expect(transformModelForProvider("google", "gemini-3-flash")).toBe("gemini-3-flash-preview")
		})

		test("passes through exact cached model ids unchanged", () => {
			providerModelsCache = {
				models: {
					google: [{ id: "gemini-2.5-flash" }],
				},
			}

			const result = transformModelForProvider("google", "gemini-2.5-flash")

			expect(result).toBe("gemini-2.5-flash")
		})

		test("resolves legacy claude version pins to newer provider models via family metadata", () => {
			providerModelsCache = {
				models: {
					"github-copilot": [{ id: "claude-opus-4.7" }],
				},
			}

			const result = transformModelForProvider("github-copilot", "claude-opus-4-6")

			expect(result).toBe("claude-opus-4.7")
		})
	})

	describe("anthropic provider", () => {
		test("transforms claude-opus-4-6 to claude-opus-4.6", () => {
			const result = transformModelForProvider("anthropic", "claude-opus-4-6")
			expect(result).toBe("claude-opus-4.6")
		})

		test("transforms claude-sonnet-4-6 to claude-sonnet-4.6", () => {
			const result = transformModelForProvider("anthropic", "claude-sonnet-4-6")
			expect(result).toBe("claude-sonnet-4.6")
		})

		test("transforms claude-haiku-4-5 to claude-haiku-4.5", () => {
			const result = transformModelForProvider("anthropic", "claude-haiku-4-5")
			expect(result).toBe("claude-haiku-4.5")
		})
	})

	describe("compatibility fallback", () => {
		test("keeps github-copilot fallback when cache is unavailable", () => {
			const result = transformModelForProvider("github-copilot", "claude-sonnet-4-5")
			expect(result).toBe("claude-sonnet-4.5")
		})

		test("uses bundled metadata for google models when cache is unavailable", () => {
			const result = transformModelForProvider("google", "gemini-3-flash")
			expect(result).toBe("gemini-3-flash")
		})

		test("passes unknown providers through unchanged", () => {
			const result = transformModelForProvider("unknown-provider", "some-model")
			expect(result).toBe("some-model")
		})
	})
})

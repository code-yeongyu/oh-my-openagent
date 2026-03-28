declare const require: (name: string) => any
const { afterEach, beforeEach, describe, expect, mock, spyOn, test } = require("bun:test")
import { resolveModelForDelegateTask } from "./model-selection"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"

describe("resolveModelForDelegateTask", () => {
	let hasConnectedProvidersSpy: ReturnType<typeof spyOn> | undefined
	let hasProviderModelsSpy: ReturnType<typeof spyOn> | undefined

	beforeEach(() => {
		mock.restore()
	})

	afterEach(() => {
		hasConnectedProvidersSpy?.mockRestore()
		hasProviderModelsSpy?.mockRestore()
	})

	describe("#given no provider cache exists (pre-cache scenario)", () => {
		beforeEach(() => {
			hasConnectedProvidersSpy = spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(false)
			hasProviderModelsSpy = spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(false)
		})

		describe("#when availableModels is empty and no user model override", () => {
			test("#then returns skipped sentinel to leave model unpinned", () => {
				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "anthropic/claude-sonnet-4-6",
					fallbackChain: [
						{ providers: ["anthropic"], model: "claude-sonnet-4-6" },
					],
					availableModels: new Set(),
					systemDefaultModel: "anthropic/claude-sonnet-4-6",
				})

				expect(result).toEqual({ skipped: true })
			})
		})

		describe("#when user explicitly set a model override", () => {
			test("#then returns the user model regardless of cache state", () => {
				const result = resolveModelForDelegateTask({
					userModel: "openai/gpt-5.4",
					categoryDefaultModel: "anthropic/claude-sonnet-4-6",
					fallbackChain: [
						{ providers: ["anthropic"], model: "claude-sonnet-4-6" },
					],
					availableModels: new Set(),
					systemDefaultModel: "anthropic/claude-sonnet-4-6",
				})

				expect(result).toEqual({ model: "openai/gpt-5.4" })
			})
		})

		describe("#when user set fallback_models but no cache exists", () => {
			test("#then returns skipped sentinel (skip fallback resolution without cache)", () => {
				const result = resolveModelForDelegateTask({
					userFallbackModels: ["openai/gpt-5.4", "google/gemini-3.1-pro"],
					categoryDefaultModel: "anthropic/claude-sonnet-4-6",
					fallbackChain: [
						{ providers: ["anthropic"], model: "claude-sonnet-4-6" },
					],
					availableModels: new Set(),
				})

				expect(result).toEqual({ skipped: true })
			})
		})
	})

	describe("#given provider cache exists", () => {
		beforeEach(() => {
			hasConnectedProvidersSpy = spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(true)
			hasProviderModelsSpy = spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(true)
		})

		describe("#when availableModels is empty (cache exists but empty)", () => {
			test("#then keeps the category default when its provider is connected", () => {
				const readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["anthropic"])

				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "anthropic/claude-sonnet-4-6",
					fallbackChain: [
						{ providers: ["anthropic"], model: "claude-sonnet-4-6" },
					],
					availableModels: new Set(),
					systemDefaultModel: "anthropic/claude-sonnet-4-6",
				})

				expect(result).toEqual({ model: "anthropic/claude-sonnet-4-6" })
				readConnectedProvidersSpy.mockRestore()
			})

			test("#then skips a disconnected category default and resolves via a connected fallback", () => {
				const readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])

				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "anthropic/claude-sonnet-4-6",
					fallbackChain: [
						{ providers: ["openai"], model: "gpt-5.4", variant: "high" },
					],
					availableModels: new Set(),
					systemDefaultModel: "anthropic/claude-sonnet-4-6",
				})

				expect(result).toEqual({
					model: "openai/gpt-5.4",
					variant: "high",
					fallbackEntry: { providers: ["openai"], model: "gpt-5.4", variant: "high" },
					matchedFallback: true,
				})
				readConnectedProvidersSpy.mockRestore()
			})

			test("#then skips disconnected user fallback models and keeps the first connected fallback", () => {
				const readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])

				const result = resolveModelForDelegateTask({
					userFallbackModels: ["anthropic/claude-sonnet-4-6", "openai/gpt-5.4"],
					availableModels: new Set(),
				})

				expect(result).toEqual({ model: "openai/gpt-5.4", matchedFallback: true })
				readConnectedProvidersSpy.mockRestore()
			})
		})

		describe("#when availableModels has entries and category default matches", () => {
			test("#then resolves via fuzzy match (existing behavior)", () => {
				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "anthropic/claude-sonnet-4-6",
					fallbackChain: [
						{ providers: ["anthropic"], model: "claude-sonnet-4-6" },
					],
					availableModels: new Set(["anthropic/claude-sonnet-4-6"]),
				})

				expect(result).toEqual({ model: "anthropic/claude-sonnet-4-6" })
			})

			test("#then trusts user-configured category model without fuzzy validation", () => {
				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "new-api-openai/gpt-5.4-high",
					isUserConfiguredCategoryModel: true,
					availableModels: new Set(["openai/gpt-5.4"]),
				})

				expect(result).toEqual({ model: "new-api-openai/gpt-5.4-high" })
			})
		})

		describe("#when user fallback models include variant syntax", () => {
			test("#then resolves a parenthesized variant against the base available model", () => {
				const result = resolveModelForDelegateTask({
					userFallbackModels: ["openai/gpt-5.2(high)"],
					availableModels: new Set(["openai/gpt-5.2"]),
				})

				expect(result).toEqual({ model: "openai/gpt-5.2", variant: "high", matchedFallback: true })
			})

			test("#then resolves a space-separated variant against the base available model", () => {
				const result = resolveModelForDelegateTask({
					userFallbackModels: ["gpt-5.2 medium"],
					availableModels: new Set(["openai/gpt-5.2"]),
				})

				expect(result).toEqual({ model: "openai/gpt-5.2", variant: "medium", matchedFallback: true })
			})
		})
	})

	describe("#given provider cache exists and connected providers are known", () => {
		let readConnectedProvidersSpy: ReturnType<typeof spyOn> | undefined

		beforeEach(() => {
			hasConnectedProvidersSpy = spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(true)
			hasProviderModelsSpy = spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(true)
		})

		afterEach(() => {
			readConnectedProvidersSpy?.mockRestore()
		})

		describe("#when availableModels is empty and fallback chain starts with unauthenticated provider", () => {
			test("#then skips unauthenticated providers and resolves to first connected one", () => {
				readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai", "anthropic"])

				const result = resolveModelForDelegateTask({
					fallbackChain: [
						{ providers: ["xai"], model: "grok-code-fast-1" },
						{ providers: ["opencode-go"], model: "minimax-m2.7" },
						{ providers: ["anthropic", "opencode"], model: "claude-haiku-4-5" },
						{ providers: ["opencode"], model: "gpt-5-nano" },
					],
					availableModels: new Set(),
				})

				expect(result).toBeDefined()
				expect(result).not.toHaveProperty("skipped")
				const resolved = result as { model: string; variant?: string }
				expect(resolved.model).toBe("anthropic/claude-haiku-4-5")
			})

			test("#then resolves first provider in entry that is connected", () => {
				readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai", "github-copilot"])

				const result = resolveModelForDelegateTask({
					fallbackChain: [
						{ providers: ["opencode-go"], model: "minimax-m2.7" },
						{ providers: ["openai", "github-copilot"], model: "gpt-5.4", variant: "high" },
					],
					availableModels: new Set(),
				})

				expect(result).toBeDefined()
				const resolved = result as { model: string; variant?: string }
				expect(resolved.model).toBe("openai/gpt-5.4")
				expect(resolved.variant).toBe("high")
			})

			test("#then falls through to system default when no provider in chain is connected", () => {
				readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["anthropic"])

				const result = resolveModelForDelegateTask({
					fallbackChain: [
						{ providers: ["xai"], model: "grok-code-fast-1" },
						{ providers: ["opencode-go"], model: "minimax-m2.7" },
					],
					availableModels: new Set(),
					systemDefaultModel: "anthropic/claude-sonnet-4-6",
				})

				expect(result).toEqual({ model: "anthropic/claude-sonnet-4-6" })
			})
		})

		describe("#when connected providers cache is null (not yet populated)", () => {
			test("#then falls back to first entry in chain (legacy behavior)", () => {
				readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)

				const result = resolveModelForDelegateTask({
					fallbackChain: [
						{ providers: ["xai"], model: "grok-code-fast-1" },
					],
					availableModels: new Set(),
				})

				expect(result).toBeDefined()
				const resolved = result as { model: string }
				expect(resolved.model).toBe("xai/grok-code-fast-1")
			})
		})
	})

	describe("#given only connected providers cache exists (no provider-models cache)", () => {
		beforeEach(() => {
			hasConnectedProvidersSpy = spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(true)
			hasProviderModelsSpy = spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(false)
		})

		describe("#when availableModels is empty", () => {
			test("#then uses connected providers to avoid disconnected category defaults", () => {
				const readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])

				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "anthropic/claude-sonnet-4-6",
					fallbackChain: [
						{ providers: ["openai"], model: "gpt-5.4" },
					],
					availableModels: new Set(),
				})

				expect(result).toEqual({
					model: "openai/gpt-5.4",
					fallbackEntry: { providers: ["openai"], model: "gpt-5.4" },
					matchedFallback: true,
				})
				readConnectedProvidersSpy.mockRestore()
			})
		})
	})
})

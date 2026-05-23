/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { resolveModelForDelegateTask } from "./model-selection"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"

function mockConnectedProviders(value: ReturnType<typeof connectedProvidersCache.readConnectedProvidersCache>) {
	const spy = spyOn(connectedProvidersCache, "readConnectedProvidersCache")
	spy.mockReturnValue(value)
	return spy
}

function mockHasConnectedProviders(value: boolean) {
	const spy = spyOn(connectedProvidersCache, "hasConnectedProvidersCache")
	spy.mockReturnValue(value)
	return spy
}

function mockHasProviderModels(value: boolean) {
	const spy = spyOn(connectedProvidersCache, "hasProviderModelsCache")
	spy.mockReturnValue(value)
	return spy
}

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
			hasConnectedProvidersSpy = mockHasConnectedProviders(false)
			hasProviderModelsSpy = mockHasProviderModels(false)
		})

		describe("#when availableModels is empty and no user model override", () => {
			test("#then returns skipped sentinel to leave model unpinned", () => {
				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "anthropic/claude-sonnet-4.6",
					fallbackChain: [
						{ providers: ["anthropic"], model: "claude-sonnet-4-6" },
					],
					availableModels: new Set(),
					systemDefaultModel: "anthropic/claude-sonnet-4.6",
				})

				expect(result).toEqual({ skipped: true })
			})
		})

		describe("#when user explicitly set a model override", () => {
			test("#then returns the user model regardless of cache state", () => {
				const result = resolveModelForDelegateTask({
					userModel: "openai/gpt-5.4",
					categoryDefaultModel: "anthropic/claude-sonnet-4.6",
					fallbackChain: [
						{ providers: ["anthropic"], model: "claude-sonnet-4-6" },
					],
					availableModels: new Set(),
					systemDefaultModel: "anthropic/claude-sonnet-4.6",
				})

				expect(result).toEqual({ model: "openai/gpt-5.4" })
			})
		})

		describe("#when user set fallback_models but no cache exists", () => {
			test("#then returns skipped sentinel (skip fallback resolution without cache)", () => {
				const result = resolveModelForDelegateTask({
					userFallbackModels: ["openai/gpt-5.4", "google/gemini-3.1-pro"],
					categoryDefaultModel: "anthropic/claude-sonnet-4.6",
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
			hasConnectedProvidersSpy = mockHasConnectedProviders(true)
			hasProviderModelsSpy = mockHasProviderModels(true)
		})

		describe("#when availableModels is empty (cache exists but empty)", () => {
			test("#then keeps the category default when its provider is connected", () => {
				const readConnectedProvidersSpy = mockConnectedProviders(["anthropic"])

				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "anthropic/claude-sonnet-4.6",
					fallbackChain: [
						{ providers: ["anthropic"], model: "claude-sonnet-4-6" },
					],
					availableModels: new Set(),
					systemDefaultModel: "anthropic/claude-sonnet-4.6",
				})

				expect(result).toEqual({ model: "anthropic/claude-sonnet-4.6" })
				readConnectedProvidersSpy.mockRestore()
			})

			test("#then skips a disconnected category default and resolves via a connected fallback", () => {
				const readConnectedProvidersSpy = mockConnectedProviders(["openai"])

				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "anthropic/claude-sonnet-4.6",
					fallbackChain: [
						{ providers: ["openai"], model: "gpt-5.4", variant: "high" },
					],
					availableModels: new Set(),
					systemDefaultModel: "anthropic/claude-sonnet-4.6",
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
				const readConnectedProvidersSpy = mockConnectedProviders(["openai"])

				const result = resolveModelForDelegateTask({
					userFallbackModels: ["anthropic/claude-sonnet-4.6", "openai/gpt-5.4"],
					availableModels: new Set(),
				})

				expect(result).toEqual({ model: "openai/gpt-5.4", matchedFallback: true })
				readConnectedProvidersSpy.mockRestore()
			})
		})

		describe("#when availableModels has entries and category default matches", () => {
			test("#then resolves via fuzzy match (existing behavior)", () => {
				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "anthropic/claude-sonnet-4.6",
					fallbackChain: [
						{ providers: ["anthropic"], model: "claude-sonnet-4-6" },
					],
					availableModels: new Set(["anthropic/claude-sonnet-4.6"]),
				})

				expect(result).toEqual({ model: "anthropic/claude-sonnet-4.6" })
			})

			test("#then skips disabled hardcoded defaults and chooses an allowed fallback", () => {
				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "github-copilot/gpt-5.5",
					fallbackChain: [
						{ providers: ["github-copilot"], model: "gpt-5.5", variant: "medium" },
						{ providers: ["openai"], model: "gpt-5.5", variant: "medium" },
					],
					availableModels: new Set(["github-copilot/gpt-5.5", "openai/gpt-5.5"]),
					disabledProviders: ["github-copilot"],
				})

				expect(result).toEqual({
					model: "openai/gpt-5.5",
					variant: "medium",
					fallbackEntry: { providers: ["openai"], model: "gpt-5.5", variant: "medium" },
					matchedFallback: true,
				})
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

		describe("#when user primary model is unreachable and user fallback_models are provided", () => {
			test("#then promotes the first reachable user fallback (regression: bug where fallback_models were ignored when userModel set)", () => {
				const result = resolveModelForDelegateTask({
					userModel: "opencode/gemini-3.1-pro high",
					userFallbackModels: [
						"amazon-bedrock/us.anthropic.claude-opus-4-7 max",
						"opencode/claude-opus-4-7 max",
						"openai/gpt-5.5",
					],
					availableModels: new Set([
						"openai/gpt-5.5",
						"openai/gpt-5.5-pro",
						"amazon-bedrock/us.anthropic.claude-opus-4-7",
					]),
				})

				expect(result).toEqual({
					model: "amazon-bedrock/us.anthropic.claude-opus-4-7",
					variant: "max",
					matchedFallback: true,
				})
			})

			test("#then keeps the user primary when it IS reachable (fast path preserved)", () => {
				const result = resolveModelForDelegateTask({
					userModel: "openai/gpt-5.5 xhigh",
					userFallbackModels: ["openai/gpt-5.4"],
					availableModels: new Set(["openai/gpt-5.5", "openai/gpt-5.4"]),
				})

				expect(result).toEqual({ model: "openai/gpt-5.5", variant: "xhigh" })
			})

			test("#then returns the user primary as-is when no user fallback is reachable either (trust-user legacy behavior)", () => {
				const result = resolveModelForDelegateTask({
					userModel: "opencode/gemini-3.1-pro high",
					userFallbackModels: ["google/gemini-3.1-pro"],
					availableModels: new Set(["openai/gpt-5.5"]),
				})

				expect(result).toEqual({ model: "opencode/gemini-3.1-pro", variant: "high" })
			})
		})
	})

	describe("#given provider cache exists and connected providers are known", () => {
		let readConnectedProvidersSpy: ReturnType<typeof spyOn> | undefined

		beforeEach(() => {
			hasConnectedProvidersSpy = mockHasConnectedProviders(true)
			hasProviderModelsSpy = mockHasProviderModels(true)
		})

		afterEach(() => {
			readConnectedProvidersSpy?.mockRestore()
		})

		describe("#when availableModels is empty and fallback chain starts with unauthenticated provider", () => {
			test("#then skips disabled providers inside connected hardcoded fallback entries", () => {
				readConnectedProvidersSpy = mockConnectedProviders(["github-copilot", "openai"])

				const result = resolveModelForDelegateTask({
					fallbackChain: [
						{ providers: ["github-copilot", "openai"], model: "gpt-5.5", variant: "medium" },
					],
					availableModels: new Set(),
					disabledProviders: ["github-copilot"],
				})

				expect(result).toEqual({
					model: "openai/gpt-5.5",
					variant: "medium",
					fallbackEntry: { providers: ["openai"], model: "gpt-5.5", variant: "medium" },
					matchedFallback: true,
				})
			})

			test("#then skips unauthenticated providers and resolves to first connected one", () => {
				readConnectedProvidersSpy = mockConnectedProviders(["openai", "anthropic"])

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
				expect(resolved.model).toBe("anthropic/claude-haiku-4.5")
			})

			test("#then resolves first provider in entry that is connected", () => {
				readConnectedProvidersSpy = mockConnectedProviders(["openai", "github-copilot"])

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
				readConnectedProvidersSpy = mockConnectedProviders(["anthropic"])

				const result = resolveModelForDelegateTask({
					fallbackChain: [
						{ providers: ["xai"], model: "grok-code-fast-1" },
						{ providers: ["opencode-go"], model: "minimax-m2.7" },
					],
					availableModels: new Set(),
					systemDefaultModel: "anthropic/claude-sonnet-4.6",
				})

				expect(result).toEqual({ model: "anthropic/claude-sonnet-4.6" })
			})
		})

		describe("#when connected providers cache is null (not yet populated)", () => {
			test("#then falls back to first entry in chain (legacy behavior)", () => {
				readConnectedProvidersSpy = mockConnectedProviders(null)

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

	describe("#given user model override includes variant syntax", () => {
		describe("#when userModel contains space-separated variant", () => {
			test("#then extracts the variant and returns the base model separately", () => {
				const result = resolveModelForDelegateTask({
					userModel: "openai/gpt-5.4 high",
					categoryDefaultModel: "anthropic/claude-sonnet-4.6",
					fallbackChain: [
						{ providers: ["anthropic"], model: "claude-sonnet-4-6" },
					],
					availableModels: new Set(["openai/gpt-5.4"]),
				})

				expect(result).toEqual({ model: "openai/gpt-5.4", variant: "high" })
			})
		})

		describe("#when userModel contains parenthesized variant", () => {
			test("#then extracts the variant and returns the base model separately", () => {
				const result = resolveModelForDelegateTask({
					userModel: "openai/gpt-5.4(max)",
					categoryDefaultModel: "anthropic/claude-sonnet-4.6",
					availableModels: new Set(),
				})

				expect(result).toEqual({ model: "openai/gpt-5.4", variant: "max" })
			})
		})

		describe("#when userModel has no variant syntax", () => {
			test("#then returns the model without a variant (backward compat)", () => {
				const result = resolveModelForDelegateTask({
					userModel: "openai/gpt-5.4",
					availableModels: new Set(),
				})

				expect(result).toEqual({ model: "openai/gpt-5.4" })
			})
		})

		describe("#when userModel has a non-variant suffix (e.g. -high in model name)", () => {
			test("#then preserves the full model name without extracting a variant", () => {
				const result = resolveModelForDelegateTask({
					userModel: "new-api-openai/gpt-5.4-high",
					availableModels: new Set(),
				})

				expect(result).toEqual({ model: "new-api-openai/gpt-5.4-high" })
			})
		})
	})

	describe("#given user-configured category model includes variant syntax", () => {
		beforeEach(() => {
			hasConnectedProvidersSpy = mockHasConnectedProviders(true)
			hasProviderModelsSpy = mockHasProviderModels(true)
		})

		describe("#when categoryDefaultModel with isUserConfiguredCategoryModel contains a space-separated variant", () => {
			test("#then extracts the variant and returns the base model separately", () => {
				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "openai/gpt-5.4 medium",
					isUserConfiguredCategoryModel: true,
					availableModels: new Set(["openai/gpt-5.4"]),
				})

				expect(result).toEqual({ model: "openai/gpt-5.4", variant: "medium" })
			})
		})

		describe("#when categoryDefaultModel with isUserConfiguredCategoryModel contains a parenthesized variant", () => {
			test("#then extracts the variant and returns the base model separately", () => {
				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "openai/gpt-5.4(xhigh)",
					isUserConfiguredCategoryModel: true,
					availableModels: new Set(),
				})

				expect(result).toEqual({ model: "openai/gpt-5.4", variant: "xhigh" })
			})
		})

		describe("#when categoryDefaultModel with isUserConfiguredCategoryModel has no variant", () => {
			test("#then returns the model without a variant (backward compat)", () => {
				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "new-api-openai/gpt-5.4-high",
					isUserConfiguredCategoryModel: true,
					availableModels: new Set(["openai/gpt-5.4"]),
				})

				expect(result).toEqual({ model: "new-api-openai/gpt-5.4-high" })
			})
		})
	})

	describe("#given only connected providers cache exists (no provider-models cache)", () => {
		beforeEach(() => {
			hasConnectedProvidersSpy = mockHasConnectedProviders(true)
			hasProviderModelsSpy = mockHasProviderModels(false)
		})

		describe("#when availableModels is empty", () => {
			test("#then uses connected providers to avoid disconnected category defaults", () => {
				const readConnectedProvidersSpy = mockConnectedProviders(["openai"])

				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "anthropic/claude-sonnet-4.6",
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

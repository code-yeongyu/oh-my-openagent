import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS , SUPPORTED_VARIANTS } from "@oh-my-opencode/model-core";
/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
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
					categoryDefaultModel: "anthropic/claude-sonnet-4.6",
					fallbackChain: [
						{ providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6 },
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
						{ providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6 },
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
						{ providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6 },
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
				const readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.ANTHROPIC])

				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "anthropic/claude-sonnet-4.6",
					fallbackChain: [
						{ providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6 },
					],
					availableModels: new Set(),
					systemDefaultModel: "anthropic/claude-sonnet-4.6",
				})

				expect(result).toEqual({ model: "anthropic/claude-sonnet-4.6" })
				readConnectedProvidersSpy.mockRestore()
			})

			test("#then skips a disconnected category default and resolves via a connected fallback", () => {
				const readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.OPENAI])

				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "anthropic/claude-sonnet-4.6",
					fallbackChain: [
						{ providers: [SUPPORTED_PROVIDERS.OPENAI], model: SUPPORTED_MODELS.GPT_5_4, variant: SUPPORTED_VARIANTS.HIGH },
					],
					availableModels: new Set(),
					systemDefaultModel: "anthropic/claude-sonnet-4.6",
				})

				expect(result).toEqual({
					model: "openai/gpt-5.4",
					variant: SUPPORTED_VARIANTS.HIGH,
					fallbackEntry: { providers: [SUPPORTED_PROVIDERS.OPENAI], model: SUPPORTED_MODELS.GPT_5_4, variant: SUPPORTED_VARIANTS.HIGH },
					matchedFallback: true,
				})
				readConnectedProvidersSpy.mockRestore()
			})

			test("#then skips disconnected user fallback models and keeps the first connected fallback", () => {
				const readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.OPENAI])

				const result = resolveModelForDelegateTask({
					userFallbackModels: ["anthropic/claude-sonnet-4.6", "openai/gpt-5.4"],
					availableModels: new Set(),
				})

				expect(result).toEqual({ model: "openai/gpt-5.4", matchedFallback: true })
				readConnectedProvidersSpy.mockRestore()
			})

			test("#then trusts readable connected providers even when cache presence flags are false", () => {
				hasConnectedProvidersSpy?.mockReturnValue(false)
				hasProviderModelsSpy?.mockReturnValue(false)
				const readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.OPENAI])

				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "anthropic/claude-sonnet-4.6",
					fallbackChain: [
						{ providers: [SUPPORTED_PROVIDERS.OPENAI], model: SUPPORTED_MODELS.GPT_5_4, variant: SUPPORTED_VARIANTS.HIGH },
					],
					availableModels: new Set(),
					systemDefaultModel: "anthropic/claude-sonnet-4.6",
				})

				expect(result).toEqual({
					model: "openai/gpt-5.4",
					variant: SUPPORTED_VARIANTS.HIGH,
					fallbackEntry: { providers: [SUPPORTED_PROVIDERS.OPENAI], model: SUPPORTED_MODELS.GPT_5_4, variant: SUPPORTED_VARIANTS.HIGH },
					matchedFallback: true,
				})
				readConnectedProvidersSpy.mockRestore()
			})
		})

		describe("#when availableModels has entries and category default matches", () => {
			test("#then resolves via fuzzy match (existing behavior)", () => {
				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "anthropic/claude-sonnet-4.6",
					fallbackChain: [
						{ providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6 },
					],
					availableModels: new Set(["anthropic/claude-sonnet-4.6"]),
				})

				expect(result).toEqual({ model: "anthropic/claude-sonnet-4.6" })
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
					userFallbackModels: ["openai/gpt-5.5(high)"],
					availableModels: new Set(["openai/gpt-5.5"]),
				})

				expect(result).toEqual({ model: "openai/gpt-5.5", variant: SUPPORTED_VARIANTS.HIGH, matchedFallback: true })
			})

			test("#then resolves a space-separated variant against the base available model", () => {
				const result = resolveModelForDelegateTask({
					userFallbackModels: ["gpt-5.5 medium"],
					availableModels: new Set(["openai/gpt-5.5"]),
				})

				expect(result).toEqual({ model: "openai/gpt-5.5", variant: SUPPORTED_VARIANTS.MEDIUM, matchedFallback: true })
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
					variant: SUPPORTED_VARIANTS.MAX,
					matchedFallback: true,
				})
			})

			test("#then keeps the user primary when it IS reachable (fast path preserved)", () => {
				const result = resolveModelForDelegateTask({
					userModel: "openai/gpt-5.5 xhigh",
					userFallbackModels: ["openai/gpt-5.4"],
					availableModels: new Set(["openai/gpt-5.5", "openai/gpt-5.4"]),
				})

				expect(result).toEqual({ model: "openai/gpt-5.5", variant: SUPPORTED_VARIANTS.XHIGH })
			})

			test("#then returns the user primary as-is when no user fallback is reachable either (trust-user legacy behavior)", () => {
				const result = resolveModelForDelegateTask({
					userModel: "opencode/gemini-3.1-pro high",
					userFallbackModels: ["google/gemini-3.1-pro"],
					availableModels: new Set(["openai/gpt-5.5"]),
				})

				expect(result).toEqual({ model: "opencode/gemini-3.1-pro", variant: SUPPORTED_VARIANTS.HIGH })
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
				readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_PROVIDERS.ANTHROPIC])

				const result = resolveModelForDelegateTask({
					fallbackChain: [
						{ providers: ["xai"], model: "grok-code-fast-1" },
						{ providers: [SUPPORTED_PROVIDERS.OPENCODE_GO], model: SUPPORTED_MODELS.MINIMAX_M2_7 },
						{ providers: [SUPPORTED_PROVIDERS.ANTHROPIC, "opencode"], model: SUPPORTED_MODELS.CLAUDE_HAIKU_4_5 },
						{ providers: ["opencode"], model: SUPPORTED_MODELS.GPT_5_NANO },
					],
					availableModels: new Set(),
				})

				expect(result).toBeDefined()
				expect(result).not.toHaveProperty("skipped")
				const resolved = result as { model: string; variant?: string }
				expect(resolved.model).toBe("anthropic/claude-haiku-4-5")
			})

			test("#then resolves first provider in entry that is connected", () => {
				readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_PROVIDERS.GITHUB_COPILOT])

				const result = resolveModelForDelegateTask({
					fallbackChain: [
						{ providers: [SUPPORTED_PROVIDERS.OPENCODE_GO], model: SUPPORTED_MODELS.MINIMAX_M2_7 },
						{ providers: [SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_PROVIDERS.GITHUB_COPILOT], model: SUPPORTED_MODELS.GPT_5_4, variant: SUPPORTED_VARIANTS.HIGH },
					],
					availableModels: new Set(),
				})

				expect(result).toBeDefined()
				const resolved = result as { model: string; variant?: string }
				expect(resolved.model).toBe("openai/gpt-5.4")
				expect(resolved.variant).toBe("high")
			})

			test("#then falls through to system default when no provider in chain is connected", () => {
				readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.ANTHROPIC])

				const result = resolveModelForDelegateTask({
					fallbackChain: [
						{ providers: ["xai"], model: "grok-code-fast-1" },
						{ providers: [SUPPORTED_PROVIDERS.OPENCODE_GO], model: SUPPORTED_MODELS.MINIMAX_M2_7 },
					],
					availableModels: new Set(),
					systemDefaultModel: "anthropic/claude-sonnet-4.6",
				})

				expect(result).toEqual({ model: "anthropic/claude-sonnet-4.6" })
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

	describe("#given user model override includes variant syntax", () => {
		describe("#when userModel contains space-separated variant", () => {
			test("#then extracts the variant and returns the base model separately", () => {
				const result = resolveModelForDelegateTask({
					userModel: "openai/gpt-5.4 high",
					categoryDefaultModel: "anthropic/claude-sonnet-4.6",
					fallbackChain: [
						{ providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6 },
					],
					availableModels: new Set(["openai/gpt-5.4"]),
				})

				expect(result).toEqual({ model: "openai/gpt-5.4", variant: SUPPORTED_VARIANTS.HIGH })
			})
		})

		describe("#when userModel contains parenthesized variant", () => {
			test("#then extracts the variant and returns the base model separately", () => {
				const result = resolveModelForDelegateTask({
					userModel: "openai/gpt-5.4(max)",
					categoryDefaultModel: "anthropic/claude-sonnet-4.6",
					availableModels: new Set(),
				})

				expect(result).toEqual({ model: "openai/gpt-5.4", variant: SUPPORTED_VARIANTS.MAX })
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
			hasConnectedProvidersSpy = spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(true)
			hasProviderModelsSpy = spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(true)
		})

		describe("#when categoryDefaultModel with isUserConfiguredCategoryModel contains a space-separated variant", () => {
			test("#then extracts the variant and returns the base model separately", () => {
				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "openai/gpt-5.4 medium",
					isUserConfiguredCategoryModel: true,
					availableModels: new Set(["openai/gpt-5.4"]),
				})

				expect(result).toEqual({ model: "openai/gpt-5.4", variant: SUPPORTED_VARIANTS.MEDIUM })
			})
		})

		describe("#when categoryDefaultModel with isUserConfiguredCategoryModel contains a parenthesized variant", () => {
			test("#then extracts the variant and returns the base model separately", () => {
				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "openai/gpt-5.4(xhigh)",
					isUserConfiguredCategoryModel: true,
					availableModels: new Set(),
				})

				expect(result).toEqual({ model: "openai/gpt-5.4", variant: SUPPORTED_VARIANTS.XHIGH })
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
			hasConnectedProvidersSpy = spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(true)
			hasProviderModelsSpy = spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(false)
		})

		describe("#when availableModels is empty", () => {
			test("#then uses connected providers to avoid disconnected category defaults", () => {
				const readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.OPENAI])

				const result = resolveModelForDelegateTask({
					categoryDefaultModel: "anthropic/claude-sonnet-4.6",
					fallbackChain: [
						{ providers: [SUPPORTED_PROVIDERS.OPENAI], model: SUPPORTED_MODELS.GPT_5_4 },
					],
					availableModels: new Set(),
				})

				expect(result).toEqual({
					model: "openai/gpt-5.4",
					fallbackEntry: { providers: [SUPPORTED_PROVIDERS.OPENAI], model: SUPPORTED_MODELS.GPT_5_4 },
					matchedFallback: true,
				})
				readConnectedProvidersSpy.mockRestore()
			})
		})
	})
})

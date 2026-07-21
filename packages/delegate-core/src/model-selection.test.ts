import { describe, expect, test } from "bun:test"
import {
  resolveModelForDelegateTask,
  type DelegateFallbackEntry,
  type DelegateModelResolutionDeps,
} from "./model-selection"

const noCacheDeps: DelegateModelResolutionDeps = {
  connectedProviders: null,
  hasProviderModelsCache: false,
  hasConnectedProvidersCache: false,
}

const nativeSolEntry: DelegateFallbackEntry = {
  providers: ["openai", "vercel"],
  model: "gpt-5.6-sol",
  variant: "xhigh",
}
const copilotSolEntry: DelegateFallbackEntry = {
  providers: ["github-copilot"],
  model: "gpt-5.6-sol",
  variant: "high",
}
const legacyGptEntry: DelegateFallbackEntry = {
  providers: ["openai", "github-copilot", "opencode", "vercel"],
  model: "gpt-5.5",
  variant: "xhigh",
}
const gpt56SolFallbackChain = [nativeSolEntry, copilotSolEntry, legacyGptEntry]

describe("resolveModelForDelegateTask", () => {
  test("#given no provider cache exists #when no user override is configured #then returns skipped sentinel", () => {
    const result = resolveModelForDelegateTask({
      availableModels: new Set(),
      categoryDefaultModel: "openai/gpt-5.4",
    }, noCacheDeps)

    expect(result).toEqual({ skipped: true })
  })

  test("#given user primary is unreachable #when fallback_models has a reachable model #then promotes fallback with variant", () => {
    const result = resolveModelForDelegateTask({
      userModel: "quotio/claude-haiku-4-5-unavailable",
      userFallbackModels: ["openai/gpt-5.4 high"],
      availableModels: new Set(["openai/gpt-5.4-preview"]),
    }, noCacheDeps)

    expect(result).toEqual({
      model: "openai/gpt-5.4-preview",
      variant: "high",
      matchedFallback: true,
    })
  })

  test("#given connected providers cache #when fallback chain starts disconnected #then selects first connected provider", () => {
    const result = resolveModelForDelegateTask({
      availableModels: new Set(),
      fallbackChain: [
        { providers: ["anthropic"], model: "claude-sonnet-4-6" },
        { providers: ["openai"], model: "gpt-5.4", variant: "medium" },
      ],
    }, {
      connectedProviders: ["openai"],
      hasProviderModelsCache: true,
      hasConnectedProvidersCache: true,
    })

    expect(result).toEqual({
      model: "openai/gpt-5.4",
      variant: "medium",
      fallbackEntry: { providers: ["openai"], model: "gpt-5.4", variant: "medium" },
      matchedFallback: true,
    })
  })

  test("#given only transformed Vercel GPT-5.6 Sol #when fallback resolves #then Vercel keeps the native xhigh rung", () => {
    const result = resolveModelForDelegateTask({
      availableModels: new Set(["vercel/openai/gpt-5.6-sol"]),
      fallbackChain: gpt56SolFallbackChain,
      systemDefaultModel: "system/default",
    }, noCacheDeps)

    expect(result).toEqual({
      model: "vercel/openai/gpt-5.6-sol",
      variant: "xhigh",
      fallbackEntry: nativeSolEntry,
      matchedFallback: true,
    })
  })

  test("#given transformed Vercel and Copilot GPT-5.6 Sol #when fallback resolves #then Vercel xhigh wins", () => {
    const result = resolveModelForDelegateTask({
      availableModels: new Set([
        "github-copilot/gpt-5.6-sol",
        "vercel/openai/gpt-5.6-sol",
      ]),
      fallbackChain: gpt56SolFallbackChain,
    }, noCacheDeps)

    expect(result).toEqual({
      model: "vercel/openai/gpt-5.6-sol",
      variant: "xhigh",
      fallbackEntry: nativeSolEntry,
      matchedFallback: true,
    })
  })

  test("#given only Copilot GPT-5.6 Sol #when fallback resolves #then the dedicated high rung wins", () => {
    const result = resolveModelForDelegateTask({
      availableModels: new Set(["github-copilot/gpt-5.6-sol"]),
      fallbackChain: gpt56SolFallbackChain,
    }, noCacheDeps)

    expect(result).toEqual({
      model: "github-copilot/gpt-5.6-sol",
      variant: "high",
      fallbackEntry: copilotSolEntry,
      matchedFallback: true,
    })
  })

  test("#given GPT-5.6 is unavailable #when Copilot GPT-5.5 exists #then the legacy fallback remains", () => {
    const result = resolveModelForDelegateTask({
      availableModels: new Set(["github-copilot/gpt-5.5"]),
      fallbackChain: gpt56SolFallbackChain,
    }, noCacheDeps)

    expect(result).toEqual({
      model: "github-copilot/gpt-5.5",
      variant: "xhigh",
      fallbackEntry: legacyGptEntry,
      matchedFallback: true,
    })
  })

  test("#given a fallback model exists through an unlisted provider #when fallback resolves #then cross-provider matching remains", () => {
    const fallbackEntry = { providers: ["openai"], model: "gpt-5.5", variant: "high" }
    const result = resolveModelForDelegateTask({
      availableModels: new Set(["custom-provider/gpt-5.5"]),
      fallbackChain: [fallbackEntry],
    }, noCacheDeps)

    expect(result).toEqual({
      model: "custom-provider/gpt-5.5",
      variant: "high",
      fallbackEntry,
      matchedFallback: true,
    })
  })

  test("#given a provider-strict fallback exists only through an unlisted provider #when fallback resolves #then it falls through", () => {
    // given
    const fallbackEntry: DelegateFallbackEntry = {
      providers: ["google", "opencode", "vercel"],
      model: "gemini-3.6-flash",
      requireListedProvider: true,
    }

    // when
    const result = resolveModelForDelegateTask({
      availableModels: new Set(["github-copilot/gemini-3.6-flash"]),
      fallbackChain: [fallbackEntry],
      systemDefaultModel: "opencode/glm-5.2",
    }, noCacheDeps)

    // then
    expect(result).toEqual({ model: "opencode/glm-5.2" })
  })

  test("#given custom and later-rung providers expose the same model #when fallback resolves #then the custom provider keeps the earlier variant", () => {
    const result = resolveModelForDelegateTask({
      availableModels: new Set([
        "long-custom-provider/gpt-5.6-sol",
        "github-copilot/gpt-5.6-sol",
      ]),
      fallbackChain: gpt56SolFallbackChain,
    }, noCacheDeps)

    expect(result).toEqual({
      model: "long-custom-provider/gpt-5.6-sol",
      variant: "xhigh",
      fallbackEntry: nativeSolEntry,
      matchedFallback: true,
    })
  })
})

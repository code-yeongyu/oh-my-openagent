import { describe, expect, test } from "bun:test"
import { resolveModelForDelegateTask, type DelegateModelResolutionDeps } from "./model-selection"

const noCacheDeps: DelegateModelResolutionDeps = {
  connectedProviders: null,
  hasProviderModelsCache: false,
  hasConnectedProvidersCache: false,
}

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

  test("#given provider-specific rungs for one model #when the later provider is available #then preserves its variant", () => {
    const copilotEntry = { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "high" }

    const result = resolveModelForDelegateTask({
      availableModels: new Set(["github-copilot/gpt-5.6-sol"]),
      fallbackChain: [
        { providers: ["openai", "vercel"], model: "gpt-5.6-sol", variant: "xhigh" },
        copilotEntry,
      ],
    }, noCacheDeps)

    expect(result).toEqual({
      model: "github-copilot/gpt-5.6-sol",
      variant: "high",
      fallbackEntry: copilotEntry,
      matchedFallback: true,
    })
  })
})

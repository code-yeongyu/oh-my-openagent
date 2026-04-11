import { describe, expect, test } from "bun:test"
import { resolveConfiguredFallbackEntry } from "./explicit-fallback-model-resolution"

describe("resolveConfiguredFallbackEntry", () => {
  test("keeps explicit string fallback pins stable against concrete available models", () => {
    const result = resolveConfiguredFallbackEntry("openai/gpt-5", {
      availableModels: new Set(["openai/gpt-5.4-preview"]),
    })

    expect(result).toEqual({
      model: "openai/gpt-5",
      original: "openai/gpt-5",
    })
  })

  test("fuzzy-resolves object fallback entries to available concrete models", () => {
    const result = resolveConfiguredFallbackEntry(
      { model: "openai/gpt-5.4", variant: "high", reasoningEffort: "high" },
      {
        availableModels: new Set(["openai/gpt-5.4-preview"]),
      },
    )

    expect(result).toEqual({
      model: "openai/gpt-5.4-preview",
      variant: "high",
      original: "openai/gpt-5.4",
    })
  })

  test("can omit object variants for callers that promote object metadata later", () => {
    const result = resolveConfiguredFallbackEntry(
      { model: "openai/gpt-5.4", variant: "high", reasoningEffort: "high" },
      {
        availableModels: new Set(["openai/gpt-5.4-preview"]),
        preserveObjectVariant: false,
      },
    )

    expect(result).toEqual({
      model: "openai/gpt-5.4-preview",
      original: "openai/gpt-5.4",
    })
  })

  test("skips cold-cache entries whose provider is known to be disconnected", () => {
    const result = resolveConfiguredFallbackEntry("openai/gpt-5.4", {
      availableModels: new Set<string>(),
      connectedProviders: ["anthropic"],
    })

    expect(result).toBeUndefined()
  })

  test("transforms cold-cache string fallback entries for connected provider compatibility", () => {
    const result = resolveConfiguredFallbackEntry("github-copilot/claude-sonnet-4-5", {
      availableModels: new Set<string>(),
      connectedProviders: ["github-copilot"],
    })

    expect(result).toEqual({
      model: "github-copilot/claude-sonnet-4.5",
      original: "github-copilot/claude-sonnet-4-5",
    })
  })
})

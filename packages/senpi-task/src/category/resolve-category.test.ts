import { describe, expect, test } from "bun:test"

import { resolveCategory } from "./index"

type FakeModel = {
  readonly provider: string
  readonly id: string
}

type FakeRegistry = {
  readonly getAvailable: () => readonly FakeModel[]
  readonly find: (provider: string, modelId: string) => FakeModel | undefined
}

function model(provider: string, id: string): FakeModel {
  return { provider, id }
}

function registry(models: readonly FakeModel[]): FakeRegistry {
  return {
    getAvailable: () => models,
    find: (provider, modelId) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

function expectResolved(result: ReturnType<typeof resolveCategory<FakeModel>>): Extract<typeof result, { readonly kind: "resolved" }> {
  if (result.kind !== "resolved") {
    throw new Error(`Expected resolved category, got ${result.kind}`)
  }
  return result
}

describe("resolveCategory", () => {
  test("#given a builtin category and omo overlay #when resolved #then user config wins and prompt text is appended", () => {
    // given
    const models = registry([model("anthropic", "claude-opus-4-7")])

    // when
    const result = resolveCategory(
      "ultrabrain",
      {
        categories: {
          ultrabrain: {
            model: "anthropic/claude-opus-4-7",
            variant: "max",
            prompt_append: "USER OVERLAY PROMPT",
          },
        },
      },
      models,
    )

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("anthropic")
    expect(resolved.spec.modelId).toBe("claude-opus-4-7")
    expect(resolved.spec.variant).toBe("max")
    expect(resolved.spec.prompt_append).toContain("DEEP LOGICAL REASONING")
    expect(resolved.spec.prompt_append).toEndWith("\n\nUSER OVERLAY PROMPT")
  })

  test("#given a disabled omo category overlay #when resolved #then a disabled result explains the reason", () => {
    // given
    const models = registry([model("openai", "gpt-5.5")])

    // when
    const result = resolveCategory(
      "ultrabrain",
      { categories: { ultrabrain: { disable: true } } },
      models,
    )

    // then
    expect(result.kind).toBe("disabled")
    if (result.kind !== "disabled") throw new Error("Expected disabled result")
    expect(result.reason).toContain("disabled")
    expect(result.availableCategories).toContain("ultrabrain")
  })

  test("#given primary model is unavailable and omo fallback exists #when resolved #then delegate-core fallback reaches the registry model", () => {
    // given
    const models = registry([model("google", "gemini-3.1-pro")])

    // when
    const result = resolveCategory(
      "ultrabrain",
      { categories: { ultrabrain: { fallback_models: ["google/gemini-3.1-pro high"] } } },
      models,
    )

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("google")
    expect(resolved.spec.modelId).toBe("gemini-3.1-pro")
    expect(resolved.spec.variant).toBe("high")
    expect(resolved.modelSelection.matchedFallback).toBe(true)
  })

  test("#given no category or fallback model resolves and a system default is available #when resolved #then delegate-core reaches the system default", () => {
    // given
    const models = registry([model("local", "system-default")])

    // when
    const result = resolveCategory("quick", {}, models, { systemDefaultModel: "local/system-default" })

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("local")
    expect(resolved.spec.modelId).toBe("system-default")
    expect(resolved.modelSelection.matchedFallback).toBe(false)
  })

  test("#given selected model is absent from registry #when resolved #then unavailable result names attempted and available models", () => {
    // given
    const models = registry([model("anthropic", "claude-sonnet-4-6")])

    // when
    const result = resolveCategory(
      "quick",
      { categories: { quick: { model: "openai/not-installed" } } },
      models,
    )

    // then
    expect(result.kind).toBe("model_unavailable")
    if (result.kind !== "model_unavailable") throw new Error("Expected unavailable result")
    expect(result.category).toBe("quick")
    expect(result.attemptedModel).toBe("openai/not-installed")
    expect(result.availableModels).toEqual(["anthropic/claude-sonnet-4-6"])
    expect(result.nearestFallback).toBeUndefined()
  })

  test("#given category params in omo overlay #when resolved #then child spec carries generation params and prompt append", () => {
    // given
    const models = registry([model("openai", "gpt-5.4-mini")])

    // when
    const result = resolveCategory(
      "quick",
      {
        categories: {
          quick: {
            temperature: 0.3,
            top_p: 0.8,
            maxTokens: 4096,
            thinking: { type: "enabled", budgetTokens: 1024 },
            reasoningEffort: "medium",
            tools: { read: true, write: false },
            prompt_append: "EXTRA QUICK CONTEXT",
          },
        },
      },
      models,
    )

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.temperature).toBe(0.3)
    expect(resolved.spec.top_p).toBe(0.8)
    expect(resolved.spec.maxTokens).toBe(4096)
    expect(resolved.spec.thinking).toEqual({ type: "enabled", budgetTokens: 1024 })
    expect(resolved.spec.reasoningEffort).toBe("medium")
    expect(resolved.spec.tools).toEqual({ read: true, write: false })
    expect(resolved.spec.prompt_append).toContain("SMALL / QUICK")
    expect(resolved.spec.prompt_append).toEndWith("\n\nEXTRA QUICK CONTEXT")
  })

  test("#given a custom category description #when resolved #then the resolved result preserves it", () => {
    // given
    const models = registry([model("openai", "custom-model")])

    // when
    const result = resolveCategory(
      "custom-review",
      {
        categories: {
          "custom-review": {
            model: "openai/custom-model",
            description: "Custom review lane",
          },
        },
      },
      models,
    )

    // then
    const resolved = expectResolved(result)
    expect(resolved.description).toBe("Custom review lane")
  })
})

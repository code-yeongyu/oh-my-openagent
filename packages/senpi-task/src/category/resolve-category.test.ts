import { describe, expect, test } from "bun:test"

import { BUILTIN_CATEGORY_DEFAULTS, resolveCategory } from "./index"

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

  test("#given quick primary is unavailable and hardcoded fallback is available #when resolved #then delegate-core fallback chain reaches Anthropic Haiku", () => {
    // given
    const models = registry([model("anthropic", "claude-haiku-4-5")])

    // when
    const result = resolveCategory("quick", {}, models)

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("anthropic")
    expect(resolved.spec.modelId).toBe("claude-haiku-4-5")
    expect(resolved.modelSelection.matchedFallback).toBe(true)
    expect(resolved.modelSelection.fallbackEntry).toEqual({
      providers: ["anthropic", "github-copilot", "vercel"],
      model: "claude-haiku-4-5",
    })
  })

  test("#given ultrabrain primary is unavailable and hardcoded Google fallback is available #when resolved #then delegate-core fallback chain preserves the high variant", () => {
    // given
    const models = registry([model("google", "gemini-3.1-pro")])

    // when
    const result = resolveCategory("ultrabrain", {}, models)

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("google")
    expect(resolved.spec.modelId).toBe("gemini-3.1-pro")
    expect(resolved.spec.variant).toBe("high")
    expect(resolved.modelSelection.matchedFallback).toBe(true)
    expect(resolved.modelSelection.fallbackEntry).toEqual({
      providers: ["google", "github-copilot", "opencode", "vercel"],
      model: "gemini-3.1-pro",
      variant: "high",
    })
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

  test("#given a registry model with legal headers #when resolved #then the header-bearing model is accepted", () => {
    // given
    const headerModel = {
      provider: "openai",
      id: "gpt-5.4-mini",
      headers: { "User-Agent": "test" },
    }

    // when
    const result = resolveCategory("quick", {}, registry([headerModel]))

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("openai")
    expect(resolved.spec.modelId).toBe("gpt-5.4-mini")
    expect(resolved.spec.model).toBe(headerModel)
  })

  test("#given a malformed registry entry #when resolved #then category resolution returns sanitized model_unavailable instead of throwing", () => {
    // given
    const malformedRegistry = {
      getAvailable: () => [null],
      find: () => undefined,
    }

    // when
    const result = resolveCategory("quick", {}, malformedRegistry)

    // then
    expect(result.kind).toBe("model_unavailable")
    if (result.kind !== "model_unavailable") throw new Error("Expected unavailable result")
    expect(result.category).toBe("quick")
    expect(result.attemptedModel).toBe("openai/gpt-5.4-mini")
    expect(result.availableModels).toEqual([])
  })

  test("#given malformed truthy find results #when resolved #then category resolution returns sanitized model_unavailable", () => {
    // given
    const malformedFindResults = [
      {},
      { provider: { secret: "hidden" }, id: ["gpt-5.4-mini"] },
      { provider: "openai", id: "gpt-5.4-mini", password: "hidden" },
      { provider: "openai", id: "gpt-5.4-mini", accessToken: "hidden" },
      { provider: "openai", id: "gpt-5.4-mini", privateToken: "hidden" },
    ]
    const availableModel = model("openai", "gpt-5.4-mini")

    // when
    const results = malformedFindResults.map((findResult) => resolveCategory("quick", {}, {
      getAvailable: () => [availableModel],
      find: () => findResult,
    }))

    // then
    for (const result of results) {
      expect(result.kind).toBe("model_unavailable")
      if (result.kind !== "model_unavailable") throw new Error(`Expected unavailable result, got ${result.kind}`)
      expect(result.attemptedModel).toBe("openai/gpt-5.4-mini")
      expect(result.availableModels).toEqual(["openai/gpt-5.4-mini"])
      expect(JSON.stringify(result)).not.toContain("hidden")
    }
  })

  test("#given inherited model identity fields #when resolved #then category resolution rejects them without leaking prototype data", () => {
    // given
    const availableModel = model("openai", "gpt-5.4-mini")
    const inheritedIdentityModel: object = Object.create({
      provider: "openai",
      id: "gpt-5.4-mini",
      privateToken: "hidden",
    })

    // when
    const result = resolveCategory("quick", {}, {
      getAvailable: () => [availableModel],
      find: () => inheritedIdentityModel,
    })

    // then
    expect(result.kind).toBe("model_unavailable")
    if (result.kind !== "model_unavailable") throw new Error(`Expected unavailable result, got ${result.kind}`)
    expect(result.attemptedModel).toBe("openai/gpt-5.4-mini")
    expect(result.availableModels).toEqual(["openai/gpt-5.4-mini"])
    expect(JSON.stringify(result)).not.toContain("hidden")
  })

  test("#given non-array registry availability #when resolved #then category resolution returns sanitized model_unavailable instead of throwing", () => {
    // given
    const malformedAvailableResults = [
      null,
      { 0: model("openai", "gpt-5.4-mini"), length: 1 },
      "openai/gpt-5.4-mini",
    ]

    // when
    const results = malformedAvailableResults.map((availableResult) => resolveCategory("quick", {}, {
      getAvailable: () => availableResult,
      find: () => model("openai", "gpt-5.4-mini"),
    }))

    // then
    for (const result of results) {
      expect(result.kind).toBe("model_unavailable")
      if (result.kind !== "model_unavailable") throw new Error(`Expected unavailable result, got ${result.kind}`)
      expect(result.attemptedModel).toBe("openai/gpt-5.4-mini")
      expect(result.availableModels).toEqual([])
    }
  })

  test("#given prototype-shaped category names #when resolved #then they return not_found instead of inherited object values", () => {
    // given
    const models = registry([model("openai", "gpt-5.4-mini")])

    // when
    const results = ["__proto__", "toString", "hasOwnProperty"].map((category) =>
      resolveCategory(category, {}, models)
    )

    // then
    expect(results.map((result) => result.kind)).toEqual(["not_found", "not_found", "not_found"])
    for (const result of results) {
      if (result.kind !== "not_found") throw new Error(`Expected not_found result, got ${result.kind}`)
      expect(result.availableCategories).toContain("quick")
    }
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

describe("builtin category defaults", () => {
  test("#given ported builtin defaults #when snapshotted #then all eight category defaults stay pinned", () => {
    // given
    const defaults = BUILTIN_CATEGORY_DEFAULTS

    // when
    const snapshotSubject = defaults.map(({ config, description, name, promptAppend }) => ({
      name,
      config,
      description,
      promptAppend,
    }))

    // then
    expect(JSON.stringify(snapshotSubject, null, 2)).toMatchSnapshot()
    expect(defaults.map((entry) => entry.name)).toEqual([
      "visual-engineering",
      "artistry",
      "ultrabrain",
      "deep",
      "quick",
      "unspecified-low",
      "unspecified-high",
      "writing",
    ])
  })
})

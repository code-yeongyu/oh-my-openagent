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

const gpt56CategoryCases = [
  { category: "ultrabrain", modelId: "gpt-5.6-sol" },
  { category: "deep", modelId: "gpt-5.6-terra" },
  { category: "unspecified-low", modelId: "gpt-5.6-luna" },
] as const

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

  test("#given writing's Kimi for Coding default is available #when resolved #then its canonical Kimi K3 id is selected", () => {
    // given
    const models = registry([model("kimi-for-coding", "kimi-k3")])

    // when
    const result = resolveCategory("writing", {}, models)

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("kimi-for-coding")
    expect(resolved.spec.modelId).toBe("kimi-k3")
    expect(resolved.modelSelection.matchedFallback).toBe(false)
  })

  test("#given writing's provider default is unavailable and Kimi K3 is available #when resolved #then the K3 fallback is selected", () => {
    // given
    const models = registry([model("opencode-go", "kimi-k3")])

    // when
    const result = resolveCategory("writing", {}, models)

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("opencode-go")
    expect(resolved.spec.modelId).toBe("kimi-k3")
    expect(resolved.modelSelection.matchedFallback).toBe(true)
    expect(resolved.modelSelection.fallbackEntry).toEqual({
      providers: ["opencode-go", "vercel"],
      model: "kimi-k3",
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

  test("#given only transformed Vercel GPT-5.6 models #when deep categories resolve #then each keeps xhigh", () => {
    for (const { category, modelId } of gpt56CategoryCases) {
      const gatewayModelId = `openai/${modelId}`
      const result = expectResolved(resolveCategory(category, {}, registry([model("vercel", gatewayModelId)])))

      expect(result.spec.provider).toBe("vercel")
      expect(result.spec.modelId).toBe(gatewayModelId)
      expect(result.spec.variant).toBe("xhigh")
      expect(result.modelSelection.fallbackEntry).toEqual({
        providers: ["openai", "vercel"],
        model: modelId,
        variant: "xhigh",
      })
    }
  })

  test("#given transformed Vercel and Copilot GPT-5.6 models #when deep categories resolve #then Vercel xhigh wins", () => {
    for (const { category, modelId } of gpt56CategoryCases) {
      const gatewayModelId = `openai/${modelId}`
      const models = registry([
        model("github-copilot", modelId),
        model("vercel", gatewayModelId),
      ])
      const result = expectResolved(resolveCategory(category, {}, models))

      expect(result.spec.provider).toBe("vercel")
      expect(result.spec.modelId).toBe(gatewayModelId)
      expect(result.spec.variant).toBe("xhigh")
      expect(result.modelSelection.fallbackEntry).toEqual({
        providers: ["openai", "vercel"],
        model: modelId,
        variant: "xhigh",
      })
    }
  })

  test("#given only Copilot GPT-5.6 models #when deep categories resolve #then each uses its high rung", () => {
    for (const { category, modelId } of gpt56CategoryCases) {
      const result = expectResolved(resolveCategory(category, {}, registry([model("github-copilot", modelId)])))

      expect(result.spec.provider).toBe("github-copilot")
      expect(result.spec.modelId).toBe(modelId)
      expect(result.spec.variant).toBe("high")
      expect(result.modelSelection.fallbackEntry).toEqual({
        providers: ["github-copilot"],
        model: modelId,
        variant: "high",
      })
    }
  })

  test("#given GPT-5.6 is unavailable #when deep resolves with Copilot GPT-5.5 #then the legacy medium fallback remains", () => {
    const result = expectResolved(resolveCategory("deep", {}, registry([model("github-copilot", "gpt-5.5")])))

    expect(result.spec.provider).toBe("github-copilot")
    expect(result.spec.modelId).toBe("gpt-5.5")
    expect(result.spec.variant).toBe("medium")
    expect(result.modelSelection.fallbackEntry).toEqual({
      providers: ["openai", "github-copilot", "opencode", "vercel"],
      model: "gpt-5.5",
      variant: "medium",
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

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
  {
    category: "ultrabrain",
    modelId: "gpt-5.6-sol",
    nativeVariant: "max",
    mixedWinner: { provider: "vercel", modelId: "openai/gpt-5.6-sol", variant: "max" },
    copilotVariant: "max",
    copilotFallbackEntry: { providers: ["github-copilot"] as string[], model: "gpt-5.6-sol", variant: "max" },
  },
  {
    category: "deep",
    modelId: "gpt-5.6-sol",
    nativeVariant: "medium",
    mixedWinner: { provider: "github-copilot", modelId: "gpt-5.6-sol", variant: "medium" },
    copilotVariant: "medium",
    copilotFallbackEntry: {
      providers: ["openai", "quotio-openai", "github-copilot", "opencode", "vercel"] as string[],
      model: "gpt-5.6-sol",
      variant: "medium",
    },
  },
  {
    category: "unspecified-low",
    modelId: "gpt-5.6-terra",
    nativeVariant: "high",
    mixedWinner: { provider: "github-copilot", modelId: "gpt-5.6-terra", variant: "high" },
    copilotVariant: "high",
    copilotFallbackEntry: {
      providers: ["openai", "quotio-openai", "github-copilot", "opencode", "vercel"] as string[],
      model: "gpt-5.6-terra",
      variant: "high",
    },
  },
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

  test("#given configured runtime fallback preserves requested and resolved models #when resolved #then the ordered runtime chain is retained", () => {
    // given
    const models = registry([
      model("vendor-b", "fallback-model"),
      model("vendor-c", "final-model"),
    ])

    // when
    const result = resolveCategory(
      "quick",
      {
        categories: {
          quick: {
            model: "vendor-a/primary-model",
            fallback_models: [
              "vendor-b/fallback-model",
              "vendor-c/final-model",
            ],
          },
        },
      },
      models,
    )

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("vendor-b")
    expect(resolved.spec.modelId).toBe("fallback-model")
    expect(resolved.spec).toMatchObject({
      requested_model: {
        source: "category",
        provider: "vendor-a",
        model_id: "primary-model",
        display: "vendor-a/primary-model",
      },
      fallback_models: [
        {
          source: "category",
          provider: "vendor-c",
          model_id: "final-model",
          display: "vendor-c/final-model",
        },
      ],
    })
  })

  test("#given a canonical models chain with per-entry reasoning #when resolved #then the canonical chain and reasoning reach the resolved model", () => {
    // given
    const models = registry([
      model("vendor-a", "primary-model"),
      model("vendor-b", "fallback-model"),
    ])

    // when
    const result = resolveCategory(
      "quick",
      {
        categories: {
          quick: {
            models: [
              { model: "vendor-a/primary-model", reasoning: "high" },
              { model: "vendor-b/fallback-model", reasoning: "off" },
            ],
          },
        },
      },
      models,
    )

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("vendor-a")
    expect(resolved.spec.modelId).toBe("primary-model")
    expect(resolved.spec.reasoningEffort).toBe("high")
    expect(resolved.spec.fallback_models?.[0]?.model_id).toBe("fallback-model")
  })

  test("#given a canonical models chain plus a conflicting legacy fallback_models #when resolved #then canonical models wins", () => {
    // given
    const models = registry([model("vendor-a", "primary-model")])

    // when
    const result = resolveCategory(
      "quick",
      {
        categories: {
          quick: {
            models: [{ model: "vendor-a/primary-model", reasoning: "high" }],
            model: "vendor-z/legacy-primary",
            fallback_models: ["vendor-z/legacy-fallback"],
          },
        },
      },
      models,
    )

    // then canonical models takes precedence over the legacy branch
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("vendor-a")
    expect(resolved.spec.modelId).toBe("primary-model")
  })

  test("#given a simple category with canonical reasoning and no chain #when resolved #then the canonical thinking level reaches the resolved model", () => {
    // given
    const models = registry([model("vendor-a", "solo-model")])

    // when
    const result = resolveCategory(
      "deep",
      { categories: { deep: { model: "vendor-a/solo-model", reasoning: "medium" } } },
      models,
    )

    // then a simple migrated {model, reasoning} keeps its thinking level
    const resolved = expectResolved(result)
    expect(resolved.spec.modelId).toBe("solo-model")
    expect(resolved.spec.reasoningEffort).toBe("medium")
  })

  test("#given quick primary is unavailable and the quotio rung is available #when resolved #then delegate-core fallback chain reaches gpt-5.6-luna-fast", () => {
    // given
    const models = registry([model("quotio-openai", "gpt-5.6-luna-fast")])

    // when
    const result = resolveCategory("quick", {}, models)

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("quotio-openai")
    expect(resolved.spec.modelId).toBe("gpt-5.6-luna-fast")
    expect(resolved.spec.variant).toBe("low")
    expect(resolved.modelSelection.matchedFallback).toBe(true)
    expect(resolved.modelSelection.fallbackEntry).toEqual({
      providers: ["quotio-openai"],
      model: "gpt-5.6-luna-fast",
      variant: "low",
    })
  })

  test("#given writing's Kimi for Coding default is available #when resolved #then its canonical Kimi K3 id is selected", () => {
    // given
    const models = registry([model("kimi-coding", "k3")])

    // when
    const result = resolveCategory("writing", {}, models)

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("kimi-coding")
    expect(resolved.spec.modelId).toBe("k3")
    expect(resolved.spec.variant).toBe("low")
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
    expect(resolved.spec.variant).toBe("low")
    expect(resolved.modelSelection.matchedFallback).toBe(true)
    expect(resolved.modelSelection.fallbackEntry).toEqual({
      providers: ["kimi-coding", "kimi-for-coding", "moonshotai", "opencode-go"],
      model: "kimi-k3",
      variant: "low",
    })
  })

  test("#given visual-engineering primary is unavailable and the ZAI GLM rung is available #when resolved #then delegate-core fallback chain preserves the max variant", () => {
    // given
    const models = registry([model("zai-coding-plan", "glm-5.2")])

    // when
    const result = resolveCategory("visual-engineering", {}, models)

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("zai-coding-plan")
    expect(resolved.spec.modelId).toBe("glm-5.2")
    expect(resolved.spec.variant).toBe("max")
    expect(resolved.modelSelection.matchedFallback).toBe(true)
    expect(resolved.modelSelection.fallbackEntry).toEqual({
      providers: ["zai-coding-plan", "opencode-go", "vercel"],
      model: "glm-5.2",
      variant: "max",
    })
  })

  test("#given only transformed Vercel GPT-5.6 models #when deep categories resolve #then each keeps its native top rung", () => {
    for (const { category, modelId, nativeVariant } of gpt56CategoryCases) {
      const gatewayModelId = `openai/${modelId}`
      const result = expectResolved(resolveCategory(category, {}, registry([model("vercel", gatewayModelId)])))

      expect(result.spec.provider).toBe("vercel")
      expect(result.spec.modelId).toBe(gatewayModelId)
      expect(result.spec.variant).toBe(nativeVariant)
      expect(result.modelSelection.fallbackEntry?.model).toBe(modelId)
      expect(result.modelSelection.fallbackEntry?.variant).toBe(nativeVariant)
    }
  })

  test("#given transformed Vercel and Copilot GPT-5.6 models #when deep categories resolve #then the first available rung provider wins", () => {
    for (const { category, modelId, mixedWinner } of gpt56CategoryCases) {
      const gatewayModelId = `openai/${modelId}`
      const models = registry([
        model("github-copilot", modelId),
        model("vercel", gatewayModelId),
      ])
      const result = expectResolved(resolveCategory(category, {}, models))

      expect(result.spec.provider).toBe(mixedWinner.provider)
      expect(result.spec.modelId).toBe(mixedWinner.modelId)
      expect(result.spec.variant).toBe(mixedWinner.variant)
      expect(result.modelSelection.fallbackEntry?.model).toBe(modelId)
    }
  })

  test("#given only Copilot GPT-5.6 models #when deep categories resolve #then each uses its copilot rung", () => {
    for (const { category, modelId, copilotVariant, copilotFallbackEntry } of gpt56CategoryCases) {
      const result = expectResolved(resolveCategory(category, {}, registry([model("github-copilot", modelId)])))

      expect(result.spec.provider).toBe("github-copilot")
      expect(result.spec.modelId).toBe(modelId)
      expect(result.spec.variant).toBe(copilotVariant)
      expect(result.modelSelection.fallbackEntry).toEqual(copilotFallbackEntry)
    }
  })

  test("#given GPT-5.6 is unavailable #when deep resolves with Copilot GPT-5.5 #then the retired rung is not selected", () => {
    const result = resolveCategory("deep", {}, registry([model("github-copilot", "gpt-5.5")]))

    expect(result.kind).toBe("model_unavailable")
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
    const models = registry([model("kimi-coding", "kimi-for-coding-highspeed")])

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
  test("#given ported builtin defaults #when snapshotted #then all nine category defaults stay pinned", () => {
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
      "architect",
      "unspecified-high",
      "writing",
    ])
  })
})

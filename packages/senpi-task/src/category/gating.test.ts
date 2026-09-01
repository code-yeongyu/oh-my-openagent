import { describe, expect, test } from "bun:test"

import { resolveCategory } from "./index"

type FakeModel = {
  readonly provider: string
  readonly id: string
}

function model(provider: string, id: string): FakeModel {
  return { provider, id }
}

function registry(models: readonly FakeModel[]) {
  return {
    getAvailable: () => models,
    find: (provider: string, modelId: string) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

const MODELS_THE_PRE_GATING_CHAINS_WOULD_HAVE_ACCEPTED = [
  model("google", "gemini-3.1-pro"),
  model("anthropic", "claude-opus-5"),
  model("opencode-go", "glm-5.2"),
  model("kimi-coding", "k3"),
] as const

describe("category activation gating", () => {
  describe("#given a builtin category gated on claude-fable-5", () => {
    test("#when the registry offers only cross-family models #then architect is unavailable and never falls back", () => {
      // given
      const models = registry(MODELS_THE_PRE_GATING_CHAINS_WOULD_HAVE_ACCEPTED)

      // when
      const result = resolveCategory("architect", {}, models)

      // then
      expect(result.kind).toBe("model_unavailable")
      if (result.kind !== "model_unavailable") throw new Error("Expected model_unavailable")
      expect(result.attemptedModel).toBe("anthropic/claude-fable-5")
      expect(result.availableCategories).not.toContain("architect")
    })

    test("#when the registry offers claude-fable-5 #then architect resolves at xhigh", () => {
      // given
      const models = registry([...MODELS_THE_PRE_GATING_CHAINS_WOULD_HAVE_ACCEPTED, model("anthropic", "claude-fable-5")])

      // when
      const result = resolveCategory("architect", {}, models)

      // then
      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.spec.provider).toBe("anthropic")
      expect(result.spec.modelId).toBe("claude-fable-5")
      expect(result.spec.variant).toBe("xhigh")
      expect(result.availableCategories).toContain("architect")
    })

    test("#when the gate model is absent but omo.json configures the category #then the explicit entry bypasses the gate", () => {
      // given
      const models = registry([model("kimi-coding", "k3")])

      // when
      const result = resolveCategory(
        "architect",
        { categories: { architect: { model: "kimi-coding/k3" } } },
        models,
      )

      // then
      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.spec.modelId).toBe("k3")
    })

    test("#when the gate model is absent and omo.json only sets a description #then the gate is bypassed and the category stays listed", () => {
      // given
      const models = registry([model("anthropic", "claude-opus-5")])

      // when
      const result = resolveCategory(
        "architect",
        { categories: { architect: { description: "House architecture consultant" } } },
        models,
      )

      // then
      expect(result.availableCategories).toContain("architect")
    })
  })

  describe("#given a builtin category gated on gpt-5.6-sol", () => {
    test("#when the registry offers only cross-family models #then ultrabrain is unavailable and never falls back", () => {
      // given
      const models = registry(MODELS_THE_PRE_GATING_CHAINS_WOULD_HAVE_ACCEPTED)

      // when
      const result = resolveCategory("ultrabrain", {}, models)

      // then
      expect(result.kind).toBe("model_unavailable")
      if (result.kind !== "model_unavailable") throw new Error("Expected model_unavailable")
      expect(result.attemptedModel).toBe("openai/gpt-5.6-sol")
      expect(result.availableCategories).not.toContain("ultrabrain")
    })

    test("#when the registry offers gpt-5.6-sol #then ultrabrain resolves at max", () => {
      // given
      const models = registry([model("openai", "gpt-5.6-sol")])

      // when
      const result = resolveCategory("ultrabrain", {}, models)

      // then
      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.spec.provider).toBe("openai")
      expect(result.spec.modelId).toBe("gpt-5.6-sol")
      expect(result.spec.variant).toBe("max")
    })

    test("#when only Copilot carries gpt-5.6-sol #then the gate is satisfied and the copilot rung applies", () => {
      // given
      const models = registry([model("github-copilot", "gpt-5.6-sol")])

      // when
      const result = resolveCategory("ultrabrain", {}, models)

      // then
      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.spec.provider).toBe("github-copilot")
      expect(result.spec.variant).toBe("max")
    })
  })

  describe("#given a builtin category gated on gpt-5.6-sol via the deep chain", () => {
    test("#when the registry offers only cross-family models #then deep is unavailable and never falls back", () => {
      // given
      const models = registry(MODELS_THE_PRE_GATING_CHAINS_WOULD_HAVE_ACCEPTED)

      // when
      const result = resolveCategory("deep", {}, models)

      // then
      expect(result.kind).toBe("model_unavailable")
      if (result.kind !== "model_unavailable") throw new Error("Expected model_unavailable")
      expect(result.attemptedModel).toBe("openai/gpt-5.6-sol")
      expect(result.availableCategories).not.toContain("deep")
    })

    test("#when the registry offers gpt-5.6-sol #then deep resolves at medium", () => {
      // given
      const models = registry([model("openai", "gpt-5.6-sol")])

      // when
      const result = resolveCategory("deep", {}, models)

      // then
      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.spec.provider).toBe("openai")
      expect(result.spec.modelId).toBe("gpt-5.6-sol")
      expect(result.spec.variant).toBe("medium")
      expect(result.availableCategories).toContain("deep")
    })

    test("#when the gate model is absent but omo.json configures the category #then the explicit entry bypasses the gate", () => {
      // given
      const models = registry([model("anthropic", "claude-opus-5")])

      // when
      const result = resolveCategory(
        "deep",
        { categories: { deep: { model: "anthropic/claude-opus-5" } } },
        models,
      )

      // then
      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.spec.modelId).toBe("claude-opus-5")
    })
  })

  describe("#given a retargeted fallback fixture", () => {
    test("#when visual-engineering resolves on a kimi-only registry #then it is a REAL chain fallback, not a primary hit", () => {
      // given
      const models = registry([model("kimi-coding", "k3")])

      // when
      const result = resolveCategory("visual-engineering", {}, models)

      // then
      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.modelSelection.matchedFallback).toBe(true)
      expect(result.spec.variant).toBe("max")
    })

    test("#when artistry resolves on a fable-only registry #then it is a PRIMARY hit, which is why it cannot prove fallback", () => {
      // given
      const models = registry([model("anthropic", "claude-fable-5")])

      // when
      const result = resolveCategory("artistry", {}, models)

      // then
      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.modelSelection.matchedFallback).toBe(false)
    })
  })

  describe("#given a registry model whose last path segment collides with a gate model", () => {
    test("#when architect resolves #then an unrelated vendor model must not open the fable gate", () => {
      // given
      const models = registry([model("custom", "unrelated/claude-fable-5")])

      // when
      const result = resolveCategory("architect", {}, models)

      // then
      expect(result.kind).toBe("model_unavailable")
      expect(result.availableCategories).not.toContain("architect")
    })

    test("#when ultrabrain resolves #then an unrelated vendor model must not open the sol gate", () => {
      // given
      const models = registry([model("custom", "unrelated/gpt-5.6-sol")])

      // when
      const result = resolveCategory("ultrabrain", {}, models)

      // then
      expect(result.kind).toBe("model_unavailable")
      expect(result.availableCategories).not.toContain("ultrabrain")
    })

    test("#when a real vercel gateway id is present #then the gate still opens", () => {
      // given
      const models = registry([model("vercel", "openai/gpt-5.6-sol")])

      // when
      const result = resolveCategory("ultrabrain", {}, models)

      // then
      expect(result.kind).toBe("resolved")
      expect(result.availableCategories).toContain("ultrabrain")
    })
  })

  describe("#given an ungated builtin category", () => {
    test("#when the registry offers only a chain rung #then the pre-gating fallback behavior is unchanged", () => {
      // given
      const models = registry([model("openai-codex", "gpt-5.6-luna-fast")])

      // when
      const result = resolveCategory("quick", {}, models)

      // then
      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.spec.modelId).toBe("gpt-5.6-luna-fast")
      expect(result.availableCategories).toContain("quick")
    })

    test("#when a gated category is unmet #then other categories stay listed as available", () => {
      // given
      const models = registry([model("openai-codex", "gpt-5.6-luna-fast")])

      // when
      const result = resolveCategory("quick", {}, models)

      // then
      expect(result.availableCategories).not.toContain("architect")
      expect(result.availableCategories).not.toContain("ultrabrain")
      expect(result.availableCategories).not.toContain("deep")
      expect(result.availableCategories).toContain("quick")
    })
  })
})

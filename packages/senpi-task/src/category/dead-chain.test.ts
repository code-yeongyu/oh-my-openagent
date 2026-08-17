import { describe, expect, test } from "bun:test"

import { CATEGORY_FALLBACK_CHAINS } from "./fallback-chains"
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

// A registry whose only providers serve none of the quick chain rungs; claude-opus-5 keeps
// visual-engineering/unspecified-high alive so the gated list is not simply empty.
const OPUS_ONLY = registry([model("omo-mock", "mock-parent"), model("anthropic", "claude-opus-5")])

describe("dead-chain category disabling", () => {
  describe("#given a builtin category whose chain has no resolvable rung", () => {
    test("#when spawned #then it fails model_unavailable with attempted_chain and missing_providers", () => {
      // given / when
      const result = resolveCategory("quick", {}, OPUS_ONLY)

      // then
      expect(result.kind).toBe("model_unavailable")
      if (result.kind !== "model_unavailable") throw new Error("Expected model_unavailable")
      expect(result.attempted_chain).toEqual(CATEGORY_FALLBACK_CHAINS.quick)
      expect(result.missing_providers).toEqual([
        "kimi-coding",
        "kimi-for-coding",
        "openai-codex",
        "deepseek",
        "qwen-token-plan",
        "alibaba-token-plan",
        "bailian-coding-plan",
        "vercel",
        "opencode-go",
        "xai",
        "anthropic-api",
        "github-copilot",
      ])
    })

    test("#when the gated category list is computed #then the dead-chain builtin is excluded", () => {
      // given / when
      const result = resolveCategory("quick", {}, OPUS_ONLY)

      // then
      expect(result.availableCategories).not.toContain("quick")
    })

    test("#when other builtins still have a live rung #then they stay listed", () => {
      // given / when
      const result = resolveCategory("quick", {}, OPUS_ONLY)

      // then
      expect(result.availableCategories).toContain("visual-engineering")
      expect(result.availableCategories).toContain("unspecified-high")
    })

    test("#when a gated builtin's chain is also dead #then the gate failure carries the chain details", () => {
      // given / when
      const result = resolveCategory("architect", {}, OPUS_ONLY)

      // then
      expect(result.kind).toBe("model_unavailable")
      if (result.kind !== "model_unavailable") throw new Error("Expected model_unavailable")
      expect(result.attempted_chain).toEqual(CATEGORY_FALLBACK_CHAINS.architect)
      expect(result.missing_providers).toContain("anthropic-api")
      expect(result.missing_providers).not.toContain("anthropic")
    })
  })

  describe("#given a registry with one kimi-coding model", () => {
    test("#when a chain rung needs the kimi transform #then the transformed id keeps the category alive", () => {
      // given
      const models = registry([model("kimi-coding", "k3")])

      // when
      const result = resolveCategory("unspecified-high", {}, models)

      // then
      expect(result.kind).toBe("resolved")
      expect(result.availableCategories).toContain("unspecified-high")
      expect(result.availableCategories).not.toContain("quick")
    })
  })

  describe("#given a gateway-prefixed registry id", () => {
    test("#when the unwrapped id matches a rung #then the category stays available", () => {
      // given
      const models = registry([model("vercel", "openai/gpt-5.6-sol")])

      // when
      const result = resolveCategory("deep", {}, models)

      // then
      expect(result.kind).toBe("resolved")
      expect(result.availableCategories).toContain("deep")
    })
  })

  describe("#given a user-configured category with an explicit model", () => {
    test("#when the builtin chain is dead #then the category is never gated and still resolves", () => {
      // given
      const models = registry([model("omo-mock", "mock-parent")])

      // when
      const result = resolveCategory(
        "quick",
        { categories: { quick: { model: "omo-mock/mock-parent" } } },
        models,
      )

      // then
      expect(result.kind).toBe("resolved")
      expect(result.availableCategories).toContain("quick")
    })

    test("#when the explicit model is missing #then the failure is a plain miss without chain details", () => {
      // given
      const models = registry([model("omo-mock", "mock-parent")])

      // when
      const result = resolveCategory(
        "quick",
        { categories: { quick: { model: "omo-mock/absent" } } },
        models,
      )

      // then
      expect(result.kind).toBe("model_unavailable")
      if (result.kind !== "model_unavailable") throw new Error("Expected model_unavailable")
      expect(result.attempted_chain).toBeUndefined()
      expect(result.availableCategories).toContain("quick")
    })
  })

  describe("#given disabled and unknown targets", () => {
    test("#when the category is disabled #then the result still returns the gated list", () => {
      // given / when
      const result = resolveCategory("quick", { categories: { quick: { disable: true } } }, OPUS_ONLY)

      // then
      expect(result.kind).toBe("disabled")
      expect(result.availableCategories).toContain("quick")
      expect(result.availableCategories).toContain("visual-engineering")
      expect(result.availableCategories).not.toContain("deep")
    })

    test("#when the category is unknown #then the result still returns the gated list", () => {
      // given / when
      const result = resolveCategory("nope", {}, OPUS_ONLY)

      // then
      expect(result.kind).toBe("not_found")
      expect(result.availableCategories).toContain("visual-engineering")
      expect(result.availableCategories).not.toContain("quick")
      expect(result.availableCategories).not.toContain("deep")
    })
  })
})

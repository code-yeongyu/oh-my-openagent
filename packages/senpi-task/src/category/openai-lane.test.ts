import { describe, expect, test } from "bun:test"

import { resolveCategory } from "./index"

// The `openai` provider is senpi's metered API-key lane; `openai-codex` is the ChatGPT subscription
// lane serving the same model ids. Builtin chains list only the subscription lane (#8300), so the
// API lane is never preferred over it, yet an API-key-only registry still resolves through the
// resolver's cross-provider fallthrough (the posture vercel-only registries already have).

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

function expectResolved(result: ReturnType<typeof resolveCategory<FakeModel>>): Extract<typeof result, { readonly kind: "resolved" }> {
  if (result.kind !== "resolved") throw new Error(`Expected resolved category, got ${result.kind}`)
  return result
}

const GPT_CATEGORY_CASES = [
  { category: "ultrabrain", modelId: "gpt-6-astra", variant: "max" },
  { category: "deep", modelId: "gpt-6-astra", variant: "high" },
  { category: "unspecified-high", modelId: "gpt-6-astra", variant: "high" },
] as const

describe("openai lane policy", () => {
  describe("#given both the openai API lane and openai-codex serve the same model", () => {
    for (const { category, modelId, variant } of GPT_CATEGORY_CASES) {
      test(`#when ${category} resolves #then the openai-codex lane wins`, () => {
        // given
        const models = registry([model("openai", modelId), model("openai-codex", modelId)])

        // when
        const result = expectResolved(resolveCategory(category, {}, models))

        // then
        expect(result.spec.provider).toBe("openai-codex")
        expect(result.spec.modelId).toBe(modelId)
        expect(result.spec.variant).toBe(variant)
      })
    }

    test("#when the API lane is listed first in the registry #then openai-codex still wins", () => {
      // given
      const models = registry([
        model("openai", "gpt-6-astra"),
        model("openai", "gpt-5.6-sol"),
        model("openai-codex", "gpt-5.6-sol"),
        model("openai-codex", "gpt-6-astra"),
      ])

      // when
      const result = expectResolved(resolveCategory("deep", {}, models))

      // then
      expect(result.spec.provider).toBe("openai-codex")
      expect(result.spec.modelId).toBe("gpt-6-astra")
      expect(result.spec.fallback_models?.map((entry) => entry.display)).toEqual(["openai-codex/gpt-5.6-sol"])
    })
  })

  describe("#given only the openai API lane", () => {
    for (const { category, modelId, variant } of GPT_CATEGORY_CASES) {
      test(`#when ${category} resolves #then cross-provider fallthrough keeps the API lane usable`, () => {
        // given
        const models = registry([model("openai", modelId)])

        // when
        const result = expectResolved(resolveCategory(category, {}, models))

        // then
        expect(result.spec.provider).toBe("openai")
        expect(result.spec.modelId).toBe(modelId)
        expect(result.spec.variant).toBe(variant)
        expect(result.availableCategories).toContain(category)
      })
    }
  })

  describe("#given only openai-codex", () => {
    test("#when deep resolves #then the subscription lane is the requested model", () => {
      // given
      const models = registry([model("openai-codex", "gpt-6-astra")])

      // when
      const result = expectResolved(resolveCategory("deep", {}, models))

      // then
      expect(result.spec.provider).toBe("openai-codex")
      expect(result.spec.requested_model?.display).toBe("openai-codex/gpt-6-astra")
    })
  })
})

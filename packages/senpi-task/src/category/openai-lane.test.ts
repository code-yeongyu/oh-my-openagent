import { describe, expect, test } from "bun:test"

import { resolveCategory } from "./index"

// The `openai` provider is senpi's metered API-key lane; `chatgpt-subscription` is the ChatGPT subscription
// lane serving the same model ids. Builtin GPT rungs list the subscription lane first and the API lane
// directly after it (#8300, #8734), so the API lane is never preferred over the subscription, yet an
// API-key-only registry still resolves on its own listed rung.

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

function expectResolved(
  result: ReturnType<typeof resolveCategory<FakeModel>>,
): Extract<typeof result, { readonly kind: "resolved" }> {
  if (result.kind !== "resolved") throw new Error(`Expected resolved category, got ${result.kind}`)
  return result
}

const GPT_CATEGORY_CASES = [
  { category: "ultrabrain", modelId: "gpt-6.2-astra", variant: "max" },
  { category: "deep-high", modelId: "gpt-6.2-astra", variant: "high" },
  { category: "deep-low", modelId: "gpt-6.2-sol", variant: "medium" },
] as const

describe("openai lane policy", () => {
  describe("#given both the openai API lane and chatgpt-subscription serve the same model", () => {
    for (const { category, modelId, variant } of GPT_CATEGORY_CASES) {
      test(`#when ${category} resolves on ${modelId} #then the chatgpt-subscription lane wins`, () => {
        // given
        const models = registry([model("openai", modelId), model("chatgpt-subscription", modelId)])

        // when
        const result = expectResolved(resolveCategory(category, {}, models))

        // then
        expect(result.spec.provider).toBe("chatgpt-subscription")
        expect(result.spec.modelId).toBe(modelId)
        expect(result.spec.variant).toBe(variant)
      })
    }

    test("#when the API lane is listed first beside older GPT models #then chatgpt-subscription still wins and no lane carries a cross-model fallback", () => {
      // given
      const models = registry([
        model("openai", "gpt-6.2-astra"),
        model("openai", "gpt-6.2-sol"),
        model("openai", "gpt-6-astra"),
        model("openai", "gpt-5.6-sol"),
        model("chatgpt-subscription", "gpt-5.6-sol"),
        model("chatgpt-subscription", "gpt-6-astra"),
        model("chatgpt-subscription", "gpt-6.2-sol"),
        model("chatgpt-subscription", "gpt-6.2-astra"),
      ])

      // when
      const results = ["ultrabrain", "deep-high", "deep-low"].map((category) =>
        expectResolved(resolveCategory(category, {}, models)),
      )

      // then
      expect(results.map((result) => `${result.spec.provider}/${result.spec.modelId}`)).toEqual([
        "chatgpt-subscription/gpt-6.2-astra",
        "chatgpt-subscription/gpt-6.2-astra",
        "chatgpt-subscription/gpt-6.2-sol",
      ])
      for (const result of results) expect(result.spec.fallback_models ?? []).toEqual([])
    })
  })

  describe("#given only the openai API lane", () => {
    for (const { category, modelId, variant } of GPT_CATEGORY_CASES) {
      test(`#when ${category} resolves on ${modelId} #then the listed API lane keeps the category usable`, () => {
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

  describe("#given only chatgpt-subscription", () => {
    test("#when deep-high resolves #then the subscription lane is the requested model", () => {
      // given
      const models = registry([model("chatgpt-subscription", "gpt-6.2-astra")])

      // when
      const result = expectResolved(resolveCategory("deep-high", {}, models))

      // then
      expect(result.spec.provider).toBe("chatgpt-subscription")
      expect(result.spec.modelId).toBe("gpt-6.2-astra")
      expect(result.spec.requested_model?.display).toBe("chatgpt-subscription/gpt-6.2-astra")
    })
  })
})

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

function throwingProviderAccessorModel(message: string): object {
  return Object.defineProperties({}, {
    provider: {
      enumerable: true,
      get() {
        throw new Error(message)
      },
    },
    id: {
      enumerable: true,
      value: "gpt-6-luna-fast",
    },
  })
}

function expectResolved(result: ReturnType<typeof resolveCategory<FakeModel>>): Extract<typeof result, { readonly kind: "resolved" }> {
  if (result.kind !== "resolved") {
    throw new Error(`Expected resolved category, got ${result.kind}`)
  }
  return result
}

describe("resolveCategory boundary parsing", () => {
  test("#given a registry model with legal headers #when resolved #then the header-bearing model is accepted", () => {
    // given
    const headerModel = {
      provider: "chatgpt-subscription",
      id: "gpt-6-luna-fast",
      headers: { "User-Agent": "test" },
    }

    // when
    const result = resolveCategory("quick", {}, registry([headerModel]))

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("chatgpt-subscription")
    expect(resolved.spec.modelId).toBe("gpt-6-luna-fast")
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
    expect(result.attemptedModel).toBe("chatgpt-subscription/gpt-6-luna-fast")
    expect(result.availableModels).toEqual([])
  })

  test("#given getAvailable returns a throwing-accessor model #when resolved #then category resolution returns sanitized model_unavailable", () => {
    // given
    const throwingModel = throwingProviderAccessorModel("hidden available accessor marker")
    const resolver = () => resolveCategory("quick", {}, {
      getAvailable: () => [throwingModel],
      find: () => undefined,
    })

    // when
    expect(resolver).not.toThrow()
    const result = resolver()

    // then
    expect(result.kind).toBe("model_unavailable")
    if (result.kind !== "model_unavailable") throw new Error(`Expected unavailable result, got ${result.kind}`)
    expect(result.attemptedModel).toBe("chatgpt-subscription/gpt-6-luna-fast")
    expect(result.availableModels).toEqual([])
    expect(JSON.stringify(result)).not.toContain("hidden available accessor marker")
  })

  test("#given malformed truthy find results #when resolved #then category resolution returns sanitized model_unavailable", () => {
    // given
    const malformedFindResults = [
      {},
      { provider: { secret: "hidden" }, id: ["gpt-6-luna-fast"] },
      { provider: "chatgpt-subscription", id: "gpt-6-luna-fast", password: "hidden" },
      { provider: "chatgpt-subscription", id: "gpt-6-luna-fast", accessToken: "hidden" },
      { provider: "chatgpt-subscription", id: "gpt-6-luna-fast", privateToken: "hidden" },
    ]
    const availableModel = model("chatgpt-subscription", "gpt-6-luna-fast")

    // when
    const results = malformedFindResults.map((findResult) => resolveCategory("quick", {}, {
      getAvailable: () => [availableModel],
      find: () => findResult,
    }))

    // then
    for (const result of results) {
      expect(result.kind).toBe("model_unavailable")
      if (result.kind !== "model_unavailable") throw new Error(`Expected unavailable result, got ${result.kind}`)
      expect(result.attemptedModel).toBe("chatgpt-subscription/gpt-6-luna-fast")
      expect(result.availableModels).toEqual(["chatgpt-subscription/gpt-6-luna-fast"])
      expect(JSON.stringify(result)).not.toContain("hidden")
    }
  })

  test("#given find returns a throwing-accessor model #when resolved #then category resolution returns sanitized model_unavailable", () => {
    // given
    const availableModel = model("chatgpt-subscription", "gpt-6-luna-fast")
    const throwingModel = throwingProviderAccessorModel("hidden find accessor marker")
    const resolver = () => resolveCategory("quick", {}, {
      getAvailable: () => [availableModel],
      find: () => throwingModel,
    })

    // when
    expect(resolver).not.toThrow()
    const result = resolver()

    // then
    expect(result.kind).toBe("model_unavailable")
    if (result.kind !== "model_unavailable") throw new Error(`Expected unavailable result, got ${result.kind}`)
    expect(result.attemptedModel).toBe("chatgpt-subscription/gpt-6-luna-fast")
    expect(result.availableModels).toEqual(["chatgpt-subscription/gpt-6-luna-fast"])
    expect(JSON.stringify(result)).not.toContain("hidden find accessor marker")
  })

  test("#given find returns an empty or mismatched identity #when resolved #then category resolution rejects the registry result", () => {
    // given
    const availableModel = model("chatgpt-subscription", "gpt-6-luna-fast")
    const malformedFindResults = [
      { provider: "", id: "" },
      { provider: "evil", id: "other" },
      { provider: "chatgpt-subscription", id: "" },
    ] satisfies readonly FakeModel[]

    // when
    const results = malformedFindResults.map((findResult) => resolveCategory("quick", {}, {
      getAvailable: () => [availableModel],
      find: () => findResult,
    }))

    // then
    for (const result of results) {
      if (result.kind === "resolved") {
        expect(result.modelSelection.selectedModel).toBe("chatgpt-subscription/gpt-6-luna-fast")
        expect(result.spec.provider).not.toBe("evil")
        expect(result.spec.modelId).not.toBe("")
        throw new Error(`Expected unavailable result, got resolved ${result.spec.provider}/${result.spec.modelId}`)
      }
      expect(result.kind).toBe("model_unavailable")
      if (result.kind !== "model_unavailable") throw new Error(`Expected unavailable result, got ${result.kind}`)
      expect(result.attemptedModel).toBe("chatgpt-subscription/gpt-6-luna-fast")
      expect(result.availableModels).toEqual(["chatgpt-subscription/gpt-6-luna-fast"])
      expect(JSON.stringify(result)).not.toContain("evil")
      expect(JSON.stringify(result)).not.toContain("other")
    }
  })

  test("#given inherited model identity fields #when resolved #then category resolution rejects them without leaking prototype data", () => {
    // given
    const availableModel = model("chatgpt-subscription", "gpt-6-luna-fast")
    const inheritedIdentityModel: object = Object.create({
      provider: "chatgpt-subscription",
      id: "gpt-6-luna-fast",
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
    expect(result.attemptedModel).toBe("chatgpt-subscription/gpt-6-luna-fast")
    expect(result.availableModels).toEqual(["chatgpt-subscription/gpt-6-luna-fast"])
    expect(JSON.stringify(result)).not.toContain("hidden")
  })

  test("#given non-array registry availability #when resolved #then category resolution returns sanitized model_unavailable instead of throwing", () => {
    // given
    const malformedAvailableResults = [
      null,
      { 0: model("chatgpt-subscription", "gpt-6-luna-fast"), length: 1 },
      "chatgpt-subscription/gpt-6-luna-fast",
    ]

    // when
    const results = malformedAvailableResults.map((availableResult) => resolveCategory("quick", {}, {
      getAvailable: () => availableResult,
      find: () => model("chatgpt-subscription", "gpt-6-luna-fast"),
    }))

    // then
    for (const result of results) {
      expect(result.kind).toBe("model_unavailable")
      if (result.kind !== "model_unavailable") throw new Error(`Expected unavailable result, got ${result.kind}`)
      expect(result.attemptedModel).toBe("chatgpt-subscription/gpt-6-luna-fast")
      expect(result.availableModels).toEqual([])
    }
  })

  test("#given prototype-shaped category names #when resolved #then they return not_found instead of inherited object values", () => {
    // given
    const models = registry([model("chatgpt-subscription", "gpt-6-luna-fast")])

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
})

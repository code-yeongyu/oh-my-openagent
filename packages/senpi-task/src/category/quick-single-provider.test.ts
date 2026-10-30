import { describe, expect, test } from "bun:test"

import { resolveCategory } from "./index"

type FakeModel = {
  readonly provider: string
  readonly id: string
}

function registry(models: readonly FakeModel[]) {
  return {
    getAvailable: () => models,
    find: (provider: string, modelId: string) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

const ZAI_MODELS = ["glm-4.7", "glm-5.2", "glm-5.3", "glm-5.3-flash", "glm-5.3-highspeed"]
const XIAOMI_MODELS = ["mimo-v2.5-pro", "mimo-v2.6-flash", "mimo-v2.6-pro"]

function only(provider: string, ids: readonly string[]) {
  return registry(ids.map((id) => ({ provider, id })))
}

describe("quick category on a single-provider machine", () => {
  describe.each([
    { provider: "zai", ids: ZAI_MODELS, model: "glm-5.3-flash" },
    { provider: "zai-coding-cn", ids: ZAI_MODELS, model: "glm-5.3-flash" },
    { provider: "xiaomi", ids: XIAOMI_MODELS, model: "mimo-v2.6-flash" },
  ])("#given only $provider is logged in", ({ provider, ids, model }) => {
    test(`#when quick is resolved #then it runs ${provider}/${model} at low effort`, () => {
      const result = resolveCategory("quick", {}, only(provider, ids))

      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error(`expected resolved, got ${result.kind}`)
      expect(result.spec.provider).toBe(provider)
      expect(result.spec.modelId).toBe(model)
      expect(result.spec.variant).toBe("low")
      expect(result.availableCategories).toContain("quick")
    })
  })

  test("#given Z.ai and a Claude login #when quick is resolved #then Haiku 5.5 medium wins from the second rung before GLM", () => {
    const result = resolveCategory("quick", {}, registry([
      ...ZAI_MODELS.map((id) => ({ provider: "zai", id })),
      { provider: "anthropic", id: "claude-haiku-5-5" },
    ]))

    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error(`expected resolved, got ${result.kind}`)
    expect(`${result.spec.provider}/${result.spec.modelId}`).toBe("anthropic/claude-haiku-5-5")
    expect(result.spec.variant).toBe("medium")
  })
})

import { describe, expect, test } from "bun:test"

import { resolveCategory } from "./index"

type FakeModel = {
  readonly provider: string
  readonly id: string
}

const solModel: FakeModel = { provider: "opencode", id: "gpt-5.6-sol" }
const registry = {
  getAvailable: (): readonly FakeModel[] => [solModel],
  find: (provider: string, modelId: string): FakeModel | undefined =>
    provider === solModel.provider && modelId === solModel.id ? solModel : undefined,
}

describe("GPT-5.6 Sol category routing", () => {
  const cases = [
    { category: "ultrabrain", variant: "max" },
    { category: "deep", variant: "medium" },
  ] as const

  for (const { category, variant } of cases) {
    test(`#given only OpenCode Sol #when ${category} resolves #then it uses the migrated GPT-5.6 rung`, () => {
      // given / when
      const result = resolveCategory(category, {}, registry)

      // then
      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error(`Expected ${category} to resolve`)
      expect(result.spec).toMatchObject({
        provider: "opencode",
        modelId: "gpt-5.6-sol",
        variant,
      })
      expect(result.modelSelection.fallbackEntry?.model).toBe("gpt-5.6-sol")
    })
  }

  test("#given only OpenCode Sol #when unspecified-low resolves #then it is unavailable because sol left its chain", () => {
    // given / when
    const result = resolveCategory("unspecified-low", {}, registry)

    // then
    expect(result.kind).toBe("model_unavailable")
  })

  test("#given only Vercel Luna #when unspecified-low resolves #then it uses the xhigh gateway rung", () => {
    // given
    const lunaModel: FakeModel = { provider: "vercel", id: "openai/gpt-5.6-luna" }
    const lunaRegistry = {
      getAvailable: (): readonly FakeModel[] => [lunaModel],
      find: (provider: string, modelId: string): FakeModel | undefined =>
        provider === lunaModel.provider && modelId === lunaModel.id ? lunaModel : undefined,
    }

    // when
    const result = resolveCategory("unspecified-low", {}, lunaRegistry)

    // then
    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error("Expected unspecified-low to resolve")
    expect(result.spec).toMatchObject({
      provider: "vercel",
      modelId: "openai/gpt-5.6-luna",
      variant: "xhigh",
    })
    expect(result.modelSelection.fallbackEntry?.model).toBe("gpt-5.6-luna")
  })
})

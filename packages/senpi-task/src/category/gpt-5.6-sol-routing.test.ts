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
    { category: "ultrabrain", variant: "xhigh" },
    { category: "deep", variant: "medium" },
    { category: "unspecified-low", variant: "medium" },
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
})

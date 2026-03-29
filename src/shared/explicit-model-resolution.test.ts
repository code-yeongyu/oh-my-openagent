import { describe, expect, test } from "bun:test"

import { resolveExplicitModel } from "./explicit-model-resolution"

describe("resolveExplicitModel", () => {
  test("preserves explicit model ID casing for unknown provider-pinned models on cold cache", () => {
    const result = resolveExplicitModel("custom/ModelX", {
      availableModels: new Set<string>(),
    })

    expect(result).toBe("custom/ModelX")
  })
})

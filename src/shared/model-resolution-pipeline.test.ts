import { describe, expect, test, mock } from "bun:test"

mock.module("./connected-providers-cache", () => ({
  readConnectedProvidersCache: () => null,
}))

import { resolveModelPipeline } from "./model-resolution-pipeline"
import { normalizeModel } from "./model-normalization"

describe("resolveModelPipeline", () => {
  test("does not return unused explicit user config metadata in override result", () => {
    // given
    console.log("NORMALIZE:", normalizeModel("openai/gpt-5.3-codex"))
    const result = resolveModelPipeline({
      intent: {
        userModel: "openai/gpt-5.3-codex",
      },
      constraints: {
        availableModels: new Set<string>(),
      },
    })
    console.log("RESULT:", result)

    // when
    const hasExplicitUserConfigField = result
      ? Object.prototype.hasOwnProperty.call(result, "explicitUserConfig")
      : false

    // then
    expect(result).toEqual({ model: "openai/gpt-5.3-codex", provenance: "override" })
    expect(hasExplicitUserConfigField).toBe(false)
  })
})


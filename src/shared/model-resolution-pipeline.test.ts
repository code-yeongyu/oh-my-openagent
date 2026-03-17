import { describe, expect, spyOn, test } from "bun:test"
import { resolveModelPipeline } from "./model-resolution-pipeline"

describe("resolveModelPipeline", () => {
  test("does not return unused explicit user config metadata in override result", () => {
    // given
    const result = resolveModelPipeline({
      intent: {
        userModel: "openai/gpt-5.3-codex",
      },
      constraints: {
        availableModels: new Set<string>(),
      },
    })

    // when
    const hasExplicitUserConfigField = result
      ? Object.prototype.hasOwnProperty.call(result, "explicitUserConfig")
      : false

    // then
    expect(result).toEqual({ model: "openai/gpt-5.3-codex", provenance: "override" })
    expect(hasExplicitUserConfigField).toBe(false)
  })

  test("warns when antigravity model is resolved without plugin", () => {
    const consoleSpy = spyOn(console, "warn").mockImplementation(() => {})

    const result = resolveModelPipeline({
      intent: {
        userModel: "google/antigravity-gemini-3-1-pro",
      },
      constraints: {
        availableModels: new Set<string>(),
      },
    })

    expect(result).toEqual({
      model: "google/antigravity-gemini-3-1-pro",
      provenance: "override",
    })

    expect(consoleSpy).toHaveBeenCalled()
    expect(consoleSpy.mock.calls[0][0]).toContain("Antigravity model detected but plugin not installed")

    consoleSpy.mockRestore()
  })
})

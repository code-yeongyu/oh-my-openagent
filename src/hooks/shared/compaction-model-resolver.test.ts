import { describe, expect, afterEach, spyOn, test } from "bun:test"
import type { FallbackModelObject } from "../../config/schema/fallback-models"
import * as sessionStateModule from "../../features/claude-code-session-state"
import { resolveCompactionModel } from "./compaction-model-resolver"

describe("resolveCompactionModel", () => {
  let getSessionAgentSpy: ReturnType<typeof spyOn> | undefined

  afterEach(() => {
    getSessionAgentSpy?.mockRestore()
    getSessionAgentSpy = undefined
  })

  test("surfaces scoped compaction fallback_models", () => {
    // given
    const fallbackModels: Array<string | FallbackModelObject> = [
      "openai/gpt-5.4",
      { model: "anthropic/claude-opus-4-7", variant: "max", reasoningEffort: "high" },
    ]
    getSessionAgentSpy = spyOn(sessionStateModule, "getSessionAgent")
    getSessionAgentSpy.mockReturnValue("sisyphus")
    const config = {
      agents: {
        sisyphus: {
          compaction: {
            model: "google/gemini-2.5-pro",
            fallback_models: fallbackModels,
          },
        },
      },
    } as unknown as Parameters<typeof resolveCompactionModel>[0]

    // when
    const result = resolveCompactionModel(config, "ses_test", "anthropic", "claude-sonnet-4-6")

    // then
    expect(result).toEqual({
      providerID: "google",
      modelID: "gemini-2.5-pro",
      fallback_models: fallbackModels,
    })
  })

  test("preserves omitted compaction fallback_models", () => {
    // given
    getSessionAgentSpy = spyOn(sessionStateModule, "getSessionAgent")
    getSessionAgentSpy.mockReturnValue("sisyphus")
    const config = {
      agents: {
        sisyphus: {
          compaction: {
            model: "google/gemini-2.5-pro",
          },
        },
      },
    } as unknown as Parameters<typeof resolveCompactionModel>[0]

    // when
    const result = resolveCompactionModel(config, "ses_test", "anthropic", "claude-sonnet-4-6")

    // then
    expect(result).toEqual({ providerID: "google", modelID: "gemini-2.5-pro" })
  })

  test("preserves fallback_models when compaction model is invalid", () => {
    // given
    const fallbackModels = ["openai/gpt-5.4", { model: "anthropic/claude-opus-4-7", variant: "max" }]
    getSessionAgentSpy = spyOn(sessionStateModule, "getSessionAgent")
    getSessionAgentSpy.mockReturnValue("sisyphus")
    const config = {
      agents: {
        sisyphus: {
          compaction: {
            model: "not-provider-qualified",
            fallback_models: fallbackModels,
          },
        },
      },
    } as unknown as Parameters<typeof resolveCompactionModel>[0]

    // when
    const result = resolveCompactionModel(config, "ses_test", "anthropic", "claude-sonnet-4-6")

    // then
    expect(result).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-6",
      fallback_models: fallbackModels,
    })
  })
})

import { afterEach, describe, expect, test } from "bun:test"
import { applySessionPromptParams } from "./session-prompt-params-helpers"
import {
  clearAllSessionPromptParams,
  getSessionPromptParams,
} from "./session-prompt-params-state"

describe("applySessionPromptParams", () => {
  afterEach(() => {
    clearAllSessionPromptParams()
  })

  test("lowers canonical reasoning to native reasoning effort when no preset exists", () => {
    // given
    const sessionID = "ses_reasoning_effort"
    const model = {
      providerID: "test-provider",
      modelID: "test-model",
      reasoning: "high",
    }

    // when
    applySessionPromptParams(sessionID, model)

    // then
    expect(getSessionPromptParams(sessionID)).toEqual({
      options: { reasoningEffort: "high" },
    })
  })

  test("maps canonical off to OpenCode's native none effort", () => {
    // given
    const sessionID = "ses_reasoning_off"
    const model = {
      providerID: "test-provider",
      modelID: "test-model",
      reasoning: "off",
    }

    // when
    applySessionPromptParams(sessionID, model)

    // then
    expect(getSessionPromptParams(sessionID)).toEqual({
      options: { reasoningEffort: "none" },
    })
  })

  test("keeps legacy reasoningEffort input working", () => {
    // given
    const sessionID = "ses_legacy_reasoning_effort"
    const model = { reasoningEffort: "medium" }

    // when
    applySessionPromptParams(sessionID, model)

    // then
    expect(getSessionPromptParams(sessionID)).toEqual({
      options: { reasoningEffort: "medium" },
    })
  })

  test("marks variant-routed reasoning so stale provider efforts cannot override it (#6614)", () => {
    // given - explicit user reasoning on a model that exposes the level as a variant preset
    const sessionID = "ses_variant_routed_reasoning"
    const model = {
      providerID: "test-provider",
      modelID: "test-model",
      runtimeModel: { variants: { xhigh: {} } },
      reasoning: "xhigh",
    }

    // when
    applySessionPromptParams(sessionID, model)

    // then - the session records that the requested level rides the variant channel,
    // leaving no reasoningEffort option for a stale provider default to hide behind
    expect(getSessionPromptParams(sessionID)).toEqual({
      reasoningViaVariant: true,
    })
  })
})

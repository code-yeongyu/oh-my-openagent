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
})

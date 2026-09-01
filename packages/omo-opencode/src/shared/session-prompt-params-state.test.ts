import { afterEach, describe, expect, test } from "bun:test"

import {
  clearAllSessionPromptParams,
  clearSessionPromptParams,
  getSessionPromptParams,
  setSessionPromptParams,
} from "./session-prompt-params-state"

describe("session-prompt-params-state", () => {
  afterEach(() => {
    clearAllSessionPromptParams()
  })

  test("stores and returns prompt params by session", () => {
    //#given
    const sessionID = "ses_prompt_params"
    const params = {
      temperature: 0.4,
      topP: 0.7,
      maxOutputTokens: 4096,
      options: {
        reasoningEffort: "high",
      },
    }

    //#when
    setSessionPromptParams(sessionID, params)

    //#then
    expect(getSessionPromptParams(sessionID)).toEqual(params)
  })

  test("returns copies so callers cannot mutate stored state", () => {
    //#given
    const sessionID = "ses_prompt_params_copy"
    setSessionPromptParams(sessionID, {
      temperature: 0.2,
      options: { reasoningEffort: "medium" },
    })

    //#when
    const result = getSessionPromptParams(sessionID)!
    result.temperature = 0.9
    result.options!.reasoningEffort = "max"

    //#then
    expect(getSessionPromptParams(sessionID)).toEqual({
      temperature: 0.2,
      options: { reasoningEffort: "medium" },
    })
  })

  test("clears a single session", () => {
    //#given
    const sessionID = "ses_prompt_params_clear"
    setSessionPromptParams(sessionID, { topP: 0.5 })

    //#when
    clearSessionPromptParams(sessionID)

    //#then
    expect(getSessionPromptParams(sessionID)).toBeUndefined()
  })
})

import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS } from "@oh-my-opencode/model-core";
import { describe, expect, test } from "bun:test"
import { clearSessionModel, getSessionModel, setSessionModel } from "./session-model-state"

describe("session-model-state", () => {
  test("stores and retrieves a session model", () => {
    //#given
    const sessionID = "ses_test"

    //#when
    setSessionModel(sessionID, { providerID: SUPPORTED_PROVIDERS.GITHUB_COPILOT, modelID: "gpt-4.1" })

    //#then
    expect(getSessionModel(sessionID)).toEqual({
      providerID: SUPPORTED_PROVIDERS.GITHUB_COPILOT,
      modelID: "gpt-4.1",
    })
  })

  test("clears a session model", () => {
    //#given
    const sessionID = "ses_clear"
    setSessionModel(sessionID, { providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: SUPPORTED_MODELS.GPT_5_5 })

    //#when
    clearSessionModel(sessionID)

    //#then
    expect(getSessionModel(sessionID)).toBeUndefined()
  })
})

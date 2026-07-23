import { describe, expect, test } from "bun:test"
import { clearSessionModel, getSessionModel, getStoredSessionModel, setSessionModel } from "./session-model-state"

describe("session-model-state", () => {
  test("stores and retrieves a session model", () => {
    //#given
    const sessionID = "ses_test"

    //#when
    setSessionModel(sessionID, { providerID: "github-copilot", modelID: "gpt-4.1" })

    //#then
    expect(getSessionModel(sessionID)).toEqual({
      providerID: "github-copilot",
      modelID: "gpt-4.1",
    })
  })

  test("keeps agent ownership metadata out of the public session model", () => {
    //#given
    const sessionID = "ses_owned"

    //#when
    setSessionModel(sessionID, { providerID: "openai", modelID: "gpt-5.4" }, "sisyphus")

    //#then
    expect(getSessionModel(sessionID)).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
    })
    expect(getStoredSessionModel(sessionID)).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
      agent: "sisyphus",
    })
  })

  test("clears a session model", () => {
    //#given
    const sessionID = "ses_clear"
    setSessionModel(sessionID, { providerID: "anthropic", modelID: "gpt-5.5" })

    //#when
    clearSessionModel(sessionID)

    //#then
    expect(getSessionModel(sessionID)).toBeUndefined()
  })
})

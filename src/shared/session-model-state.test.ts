import { describe, expect, test } from "bun:test"
import {
  clearSessionModel,
  clearSessionVariant,
  getSessionModel,
  getSessionVariant,
  setSessionModel,
  setSessionVariant,
} from "./session-model-state"

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

  test("clears a session model", () => {
    //#given
    const sessionID = "ses_clear"
    setSessionModel(sessionID, { providerID: "anthropic", modelID: "gpt-5.3-codex" })

    //#when
    clearSessionModel(sessionID)

    //#then
    expect(getSessionModel(sessionID)).toBeUndefined()
  })

  test("stores and retrieves a session variant", () => {
    //#given
    const sessionID = "ses_variant"

    //#when
    setSessionVariant(sessionID, "medium")

    //#then
    expect(getSessionVariant(sessionID)).toBe("medium")
  })

  test("clears a session variant", () => {
    //#given
    const sessionID = "ses_variant_clear"
    setSessionVariant(sessionID, "xhigh")

    //#when
    clearSessionVariant(sessionID)

    //#then
    expect(getSessionVariant(sessionID)).toBeUndefined()
  })
})

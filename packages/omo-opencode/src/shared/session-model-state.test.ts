import { describe, expect, test } from "bun:test"
import {
  clearSessionModel,
  getSessionModel,
  markSessionModelFallback,
  restoreSessionModelFallback,
  setSessionModel,
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
    setSessionModel(sessionID, { providerID: "anthropic", modelID: "gpt-5.5" })

    //#when
    clearSessionModel(sessionID)

    //#then
    expect(getSessionModel(sessionID)).toBeUndefined()
  })

  test("restores the original model after a temporary fallback model is observed", () => {
    //#given
    const sessionID = "ses_restore_fallback"
    setSessionModel(sessionID, { providerID: "anthropic", modelID: "claude-opus-4-7" })
    markSessionModelFallback(sessionID, { providerID: "openai", modelID: "gpt-5.5" })

    //#when
    const restored = restoreSessionModelFallback(sessionID, { providerID: "openai", modelID: "gpt-5.5" })

    //#then
    expect(restored).toBe(true)
    expect(getSessionModel(sessionID)).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-7" })
  })

  test("does not restore when an unrelated model is observed", () => {
    //#given
    const sessionID = "ses_restore_fallback_mismatch"
    setSessionModel(sessionID, { providerID: "anthropic", modelID: "claude-opus-4-7" })
    markSessionModelFallback(sessionID, { providerID: "openai", modelID: "gpt-5.5" })

    //#when
    const restored = restoreSessionModelFallback(sessionID, { providerID: "google", modelID: "gemini-3.1-pro" })

    //#then
    expect(restored).toBe(false)
    expect(getSessionModel(sessionID)).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-7" })
  })
})

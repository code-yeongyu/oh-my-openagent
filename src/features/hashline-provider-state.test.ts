import { describe, expect, test, beforeEach } from "bun:test"
import { setProvider, getProvider, clearProvider } from "./hashline-provider-state"

describe("hashline-provider-state", () => {
  beforeEach(() => {
    // Clear state before each test
    clearProvider("test-session-1")
    clearProvider("test-session-2")
  })

  describe("setProvider", () => {
    test("should store provider ID for a session", () => {
      // given
      const sessionID = "test-session-1"
      const providerID = "openai"

      // when
      setProvider(sessionID, providerID)

      // then
      expect(getProvider(sessionID)).toBe("openai")
    })

    test("should overwrite existing provider for same session", () => {
      // given
      const sessionID = "test-session-1"
      setProvider(sessionID, "openai")

      // when
      setProvider(sessionID, "anthropic")

      // then
      expect(getProvider(sessionID)).toBe("anthropic")
    })
  })

  describe("getProvider", () => {
    test("should return undefined for non-existent session", () => {
      // given
      const sessionID = "non-existent-session"

      // when
      const result = getProvider(sessionID)

      // then
      expect(result).toBeUndefined()
    })

    test("should return stored provider ID", () => {
      // given
      const sessionID = "test-session-1"
      setProvider(sessionID, "anthropic")

      // when
      const result = getProvider(sessionID)

      // then
      expect(result).toBe("anthropic")
    })

    test("should handle multiple sessions independently", () => {
      // given
      setProvider("session-1", "openai")
      setProvider("session-2", "anthropic")

      // when
      const result1 = getProvider("session-1")
      const result2 = getProvider("session-2")

      // then
      expect(result1).toBe("openai")
      expect(result2).toBe("anthropic")
    })
  })

  describe("clearProvider", () => {
    test("should remove provider for a session", () => {
      // given
      const sessionID = "test-session-1"
      setProvider(sessionID, "openai")

      // when
      clearProvider(sessionID)

      // then
      expect(getProvider(sessionID)).toBeUndefined()
    })

    test("should not affect other sessions", () => {
      // given
      setProvider("session-1", "openai")
      setProvider("session-2", "anthropic")

      // when
      clearProvider("session-1")

      // then
      expect(getProvider("session-1")).toBeUndefined()
      expect(getProvider("session-2")).toBe("anthropic")
    })

    test("should handle clearing non-existent session gracefully", () => {
      // given
      const sessionID = "non-existent"

      // when
      clearProvider(sessionID)

      // then
      expect(getProvider(sessionID)).toBeUndefined()
    })
  })
})

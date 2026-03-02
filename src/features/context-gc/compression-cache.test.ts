import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test"
import { clearSession, isProcessed, markProcessed, setCompressionTier, getCompressionTier, isAlreadyCompressedAt, clearCompressionTiers } from "./compression-cache"

describe("compression-cache", () => {
  beforeEach(() => {
    mock.restore()
    clearSession("session-a")
    clearSession("session-b")
    clearCompressionTiers("session-a")
    clearCompressionTiers("session-b")
  })

  describe("#given a fresh session/message pair", () => {
    describe("#when markProcessed is called", () => {
      it("#then isProcessed should transition from false to true", () => {
        expect(isProcessed("session-a", "msg-1")).toBe(false)
        markProcessed("session-a", "msg-1")
        expect(isProcessed("session-a", "msg-1")).toBe(true)
      })
    })
  })

  describe("#given multiple sessions", () => {
    describe("#when messages are marked in one session", () => {
      it("#then processed state should stay isolated per session", () => {
        markProcessed("session-a", "msg-1")
        expect(isProcessed("session-a", "msg-1")).toBe(true)
        expect(isProcessed("session-b", "msg-1")).toBe(false)
      })
    })
  })

  describe("#given an existing processed entry", () => {
    describe("#when clearSession is called", () => {
      it("#then all message entries for that session should be removed", () => {
        markProcessed("session-a", "msg-1")
        markProcessed("session-a", "msg-2")
        clearSession("session-a")

        expect(isProcessed("session-a", "msg-1")).toBe(false)
        expect(isProcessed("session-a", "msg-2")).toBe(false)
      })

      it("#then should not affect other sessions", () => {
        markProcessed("session-a", "msg-1")
        markProcessed("session-b", "msg-1")
        clearSession("session-a")

        expect(isProcessed("session-a", "msg-1")).toBe(false)
        expect(isProcessed("session-b", "msg-1")).toBe(true)
      })
    })
  })

  describe("#given test-local spies", () => {
    describe("#when spyOn is used in this file", () => {
      it("#then should observe set operations while preserving behavior", () => {
        const setAddSpy = spyOn(Set.prototype, "add")
        markProcessed("session-a", "msg-1")
        expect(setAddSpy).toHaveBeenCalledWith("msg-1")
        setAddSpy.mockRestore()
      })
    })
  })

  describe("#given compression tier tracking", () => {
    describe("#when setCompressionTier is called", () => {
      it("#then getCompressionTier should return the stored tier", () => {
        expect(getCompressionTier("session-a", "msg-1")).toBeNull()
        setCompressionTier("session-a", "msg-1", "warm")
        expect(getCompressionTier("session-a", "msg-1")).toBe("warm")
      })
    })

    describe("#when checking isAlreadyCompressedAt", () => {
      it("#then should return true for same tier", () => {
        setCompressionTier("session-a", "msg-1", "warm")
        expect(isAlreadyCompressedAt("session-a", "msg-1", "warm")).toBe(true)
      })

      it("#then should return true for shallower tier when already cold", () => {
        setCompressionTier("session-a", "msg-1", "cold")
        expect(isAlreadyCompressedAt("session-a", "msg-1", "warm")).toBe(true)
        expect(isAlreadyCompressedAt("session-a", "msg-1", "cold")).toBe(true)
      })

      it("#then should return false for deeper tier when only warm", () => {
        setCompressionTier("session-a", "msg-1", "warm")
        expect(isAlreadyCompressedAt("session-a", "msg-1", "cold")).toBe(false)
      })

      it("#then should return false for unknown messages", () => {
        expect(isAlreadyCompressedAt("session-a", "msg-unknown", "warm")).toBe(false)
      })
    })

    describe("#when clearCompressionTiers is called", () => {
      it("#then should remove all tier entries for the session", () => {
        setCompressionTier("session-a", "msg-1", "cold")
        setCompressionTier("session-a", "msg-2", "warm")
        clearCompressionTiers("session-a")
        expect(getCompressionTier("session-a", "msg-1")).toBeNull()
        expect(getCompressionTier("session-a", "msg-2")).toBeNull()
      })

      it("#then should not affect other sessions", () => {
        setCompressionTier("session-a", "msg-1", "cold")
        setCompressionTier("session-b", "msg-1", "warm")
        clearCompressionTiers("session-a")
        expect(getCompressionTier("session-b", "msg-1")).toBe("warm")
      })
    })
  })
})

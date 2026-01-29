import { describe, test, expect, beforeEach } from "bun:test"
import {
  tryAcquireContinuationMutex,
  releaseContinuationMutex,
  getContinuationMutexHolder,
  isContinuationMutexHeldBy,
  cleanupContinuationMutex,
} from "./continuation-mutex"

describe("continuation-mutex", () => {
  const SESSION_ID = "test-session-123"

  beforeEach(() => {
    // Clean up before each test
    cleanupContinuationMutex(SESSION_ID)
  })

  describe("tryAcquireContinuationMutex", () => {
    test("acquires mutex when not held", () => {
      //#given - mutex not held
      //#when - try to acquire
      const result = tryAcquireContinuationMutex(SESSION_ID, "boulder")
      //#then - returns true
      expect(result).toBe(true)
    })

    test("allows same source to re-acquire (idempotent)", () => {
      //#given - mutex held by boulder
      tryAcquireContinuationMutex(SESSION_ID, "boulder")
      //#when - boulder tries again
      const result = tryAcquireContinuationMutex(SESSION_ID, "boulder")
      //#then - returns true
      expect(result).toBe(true)
    })

    test("denies different source when mutex held", () => {
      //#given - mutex held by boulder
      tryAcquireContinuationMutex(SESSION_ID, "boulder")
      //#when - todo tries to acquire
      const result = tryAcquireContinuationMutex(SESSION_ID, "todo")
      //#then - returns false
      expect(result).toBe(false)
    })

    test("allows acquisition after release", () => {
      //#given - mutex was held and released
      tryAcquireContinuationMutex(SESSION_ID, "boulder")
      releaseContinuationMutex(SESSION_ID)
      //#when - todo tries to acquire
      const result = tryAcquireContinuationMutex(SESSION_ID, "todo")
      //#then - returns true
      expect(result).toBe(true)
    })
  })

  describe("getContinuationMutexHolder", () => {
    test("returns null when not held", () => {
      //#given - no mutex acquired
      //#when - check holder
      const holder = getContinuationMutexHolder(SESSION_ID)
      //#then - returns null
      expect(holder).toBeNull()
    })

    test("returns source when held", () => {
      //#given - mutex held by todo
      tryAcquireContinuationMutex(SESSION_ID, "todo")
      //#when - check holder
      const holder = getContinuationMutexHolder(SESSION_ID)
      //#then - returns todo
      expect(holder).toBe("todo")
    })

    test("returns null after release", () => {
      //#given - mutex released
      tryAcquireContinuationMutex(SESSION_ID, "boulder")
      releaseContinuationMutex(SESSION_ID)
      //#when - check holder
      const holder = getContinuationMutexHolder(SESSION_ID)
      //#then - returns null
      expect(holder).toBeNull()
    })
  })

  describe("isContinuationMutexHeldBy", () => {
    test("returns true for matching source", () => {
      //#given - mutex held by boulder
      tryAcquireContinuationMutex(SESSION_ID, "boulder")
      //#when - check if held by boulder
      const result = isContinuationMutexHeldBy(SESSION_ID, "boulder")
      //#then - returns true
      expect(result).toBe(true)
    })

    test("returns false for non-matching source", () => {
      //#given - mutex held by boulder
      tryAcquireContinuationMutex(SESSION_ID, "boulder")
      //#when - check if held by todo
      const result = isContinuationMutexHeldBy(SESSION_ID, "todo")
      //#then - returns false
      expect(result).toBe(false)
    })

    test("returns false when not held", () => {
      //#given - no mutex acquired
      //#when - check if held by boulder
      const result = isContinuationMutexHeldBy(SESSION_ID, "boulder")
      //#then - returns false
      expect(result).toBe(false)
    })
  })

  describe("cleanupContinuationMutex", () => {
    test("removes mutex state", () => {
      //#given - mutex held
      tryAcquireContinuationMutex(SESSION_ID, "boulder")
      //#when - cleanup
      cleanupContinuationMutex(SESSION_ID)
      //#then - no longer held
      expect(getContinuationMutexHolder(SESSION_ID)).toBeNull()
    })
  })

  describe("independent sessions", () => {
    test("different sessions have independent mutexes", () => {
      //#given - session1 holds boulder mutex
      tryAcquireContinuationMutex("session-1", "boulder")
      //#when - session2 tries to acquire todo
      const result = tryAcquireContinuationMutex("session-2", "todo")
      //#then - returns true (independent)
      expect(result).toBe(true)
      expect(getContinuationMutexHolder("session-1")).toBe("boulder")
      expect(getContinuationMutexHolder("session-2")).toBe("todo")
      
      // Cleanup
      cleanupContinuationMutex("session-1")
      cleanupContinuationMutex("session-2")
    })
  })
})

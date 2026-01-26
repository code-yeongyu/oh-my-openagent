import { describe, test, expect, beforeEach } from "bun:test"
import {
  markCompaction,
  isInCompactionCooldown,
  getCompactionCooldownRemaining,
  clearCompactionState,
  markCompactionInProgress,
  clearCompactionInProgress,
  isCompactionInProgress,
  POST_COMPACT_COOLDOWN_MS,
  COMPACTION_IN_PROGRESS_TIMEOUT_MS,
} from "./compaction-state"

describe("compaction-state", () => {
  const TEST_SESSION_ID = "test-session-123"

  beforeEach(() => {
    // Clean up state between tests
    clearCompactionState(TEST_SESSION_ID)
    clearCompactionInProgress(TEST_SESSION_ID)
  })

  describe("existing cooldown functionality", () => {
    test("#given no compaction marked #when checking cooldown #then returns false", () => {
      // #given - no compaction marked
      clearCompactionState(TEST_SESSION_ID)

      // #when - checking cooldown
      const result = isInCompactionCooldown(TEST_SESSION_ID)

      // #then - returns false
      expect(result).toBe(false)
    })

    test("#given compaction marked #when checking immediately #then returns true", () => {
      // #given - compaction marked
      markCompaction(TEST_SESSION_ID)

      // #when - checking immediately
      const result = isInCompactionCooldown(TEST_SESSION_ID)

      // #then - returns true (in cooldown)
      expect(result).toBe(true)
    })

    test("#given compaction marked #when getting remaining #then returns positive value", () => {
      // #given - compaction marked
      markCompaction(TEST_SESSION_ID)

      // #when - getting remaining cooldown
      const remaining = getCompactionCooldownRemaining(TEST_SESSION_ID)

      // #then - returns positive value close to POST_COMPACT_COOLDOWN_MS
      expect(remaining).toBeGreaterThan(0)
      expect(remaining).toBeLessThanOrEqual(POST_COMPACT_COOLDOWN_MS)
    })

    test("#given compaction marked #when cleared #then cooldown is false", () => {
      // #given - compaction marked
      markCompaction(TEST_SESSION_ID)
      expect(isInCompactionCooldown(TEST_SESSION_ID)).toBe(true)

      // #when - cleared
      clearCompactionState(TEST_SESSION_ID)

      // #then - cooldown is false
      expect(isInCompactionCooldown(TEST_SESSION_ID)).toBe(false)
    })
  })

  describe("in-progress guard functionality", () => {
    test("#given no in-progress marked #when checking #then returns false", () => {
      // #given - no in-progress marked
      clearCompactionInProgress(TEST_SESSION_ID)

      // #when - checking
      const result = isCompactionInProgress(TEST_SESSION_ID)

      // #then - returns false
      expect(result).toBe(false)
    })

    test("#given in-progress marked #when checking immediately #then returns true", () => {
      // #given - in-progress marked
      markCompactionInProgress(TEST_SESSION_ID)

      // #when - checking immediately
      const result = isCompactionInProgress(TEST_SESSION_ID)

      // #then - returns true
      expect(result).toBe(true)
    })

    test("#given in-progress marked #when cleared #then returns false", () => {
      // #given - in-progress marked
      markCompactionInProgress(TEST_SESSION_ID)
      expect(isCompactionInProgress(TEST_SESSION_ID)).toBe(true)

      // #when - cleared
      clearCompactionInProgress(TEST_SESSION_ID)

      // #then - returns false
      expect(isCompactionInProgress(TEST_SESSION_ID)).toBe(false)
    })

    test("#given COMPACTION_IN_PROGRESS_TIMEOUT_MS #then is 30 seconds", () => {
      // #given / #when / #then - timeout constant is 30 seconds
      expect(COMPACTION_IN_PROGRESS_TIMEOUT_MS).toBe(30000)
    })

    test("#given multiple sessions #when marking different sessions #then each tracked independently", () => {
      // #given - two different sessions
      const session1 = "session-1"
      const session2 = "session-2"

      // #when - mark session1 in progress
      markCompactionInProgress(session1)

      // #then - session1 is in progress, session2 is not
      expect(isCompactionInProgress(session1)).toBe(true)
      expect(isCompactionInProgress(session2)).toBe(false)

      // #when - mark session2, clear session1
      markCompactionInProgress(session2)
      clearCompactionInProgress(session1)

      // #then - session1 is not in progress, session2 is
      expect(isCompactionInProgress(session1)).toBe(false)
      expect(isCompactionInProgress(session2)).toBe(true)

      // Cleanup
      clearCompactionInProgress(session2)
    })
  })
})

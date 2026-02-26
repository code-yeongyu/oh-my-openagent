import { describe, expect, test, beforeEach } from "bun:test"
import {
  setSessionPlanName,
  getSessionPlanName,
  clearSessionPlanName,
  _resetPlanTrackerForTesting,
} from "./plan-name-tracker"

describe("plan-name-tracker", () => {
  beforeEach(() => {
    _resetPlanTrackerForTesting()
  })

  describe("#given session plan mapping", () => {
    test("should store and retrieve plan name for session", () => {
      // given
      const sessionID = "session-123"
      const planName = "my-plan"

      // when
      setSessionPlanName(sessionID, planName)
      const result = getSessionPlanName(sessionID)

      // then
      expect(result).toBe(planName)
    })

    test("should return undefined for unknown session", () => {
      // given
      const unknownSessionID = "unknown-session"

      // when
      const result = getSessionPlanName(unknownSessionID)

      // then
      expect(result).toBeUndefined()
    })

    test("should clear plan name for session", () => {
      // given
      const sessionID = "session-456"
      const planName = "another-plan"
      setSessionPlanName(sessionID, planName)

      // when
      clearSessionPlanName(sessionID)
      const result = getSessionPlanName(sessionID)

      // then
      expect(result).toBeUndefined()
    })

    test("should be idempotent on clear for unknown session", () => {
      // given
      const unknownSessionID = "unknown-session"

      // when - clearing a session that was never set
      clearSessionPlanName(unknownSessionID)
      const result = getSessionPlanName(unknownSessionID)

      // then - should not throw and return undefined
      expect(result).toBeUndefined()
    })

    test("should not update plan name if already set", () => {
      // given
      const sessionID = "session-789"
      const firstPlan = "first-plan"
      const secondPlan = "second-plan"
      setSessionPlanName(sessionID, firstPlan)

      // when - attempt to set a different plan
      setSessionPlanName(sessionID, secondPlan)
      const result = getSessionPlanName(sessionID)

      // then - should keep the first plan (idempotent)
      expect(result).toBe(firstPlan)
    })
  })
})

import { describe, it, expect, beforeEach } from "bun:test"
import { createPhaseRollback, type PhaseRollback } from "./phase-rollback"

describe("PhaseRollback", () => {
  let rollback: PhaseRollback

  beforeEach(() => {
    rollback = createPhaseRollback("implementation")
  })

  describe("extractFailureReason", () => {
    //#given an error message
    //#when extracting failure reason
    //#then it should identify the correct phase
    it("should extract failure reason from error message", () => {
      const failure = rollback.extractFailureReason("Type error: Cannot assign string to number")

      expect(failure.phase).toBe("implementation")
      expect(failure.reason).toContain("Type error")
      expect(failure.timestamp).toBeInstanceOf(Date)
    })

    it("should detect verification phase from test failures", () => {
      const failure = rollback.extractFailureReason("Test failed: expected true but got false")

      expect(failure.phase).toBe("verification")
    })

    it("should detect planning phase from design issues", () => {
      const failure = rollback.extractFailureReason("Architecture requirement not met")

      expect(failure.phase).toBe("planning")
    })
  })

  describe("suggestRollbackPhase", () => {
    //#given a failure in a specific phase
    //#when suggesting rollback
    //#then it should suggest the previous phase
    it("should suggest rollback to previous phase", () => {
      const failure = rollback.extractFailureReason("Test failed: assertion error")
      const suggested = rollback.suggestRollbackPhase(failure)

      expect(suggested).toBe("review")
    })

    it("should suggest planning for planning failures", () => {
      const failure = rollback.extractFailureReason("Design flaw detected")
      const suggested = rollback.suggestRollbackPhase(failure)

      expect(suggested).toBe("planning")
    })
  })

  describe("rollbackTo", () => {
    //#given a rollback request
    //#when rolling back
    //#then it should record in history
    it("should rollback to specific phase and record history", () => {
      const result = rollback.rollbackTo("planning", "Need to redesign")

      expect(result.from).toBe("implementation")
      expect(result.to).toBe("planning")
      expect(result.reason).toBe("Need to redesign")

      const history = rollback.getHistory()
      expect(history).toHaveLength(1)
      expect(history[0]).toEqual(result)
    })
  })

  describe("history management", () => {
    //#given multiple rollbacks
    //#when checking history
    //#then it should preserve rollback records
    it("should preserve rollback history", () => {
      rollback.rollbackTo("planning", "First rollback")
      rollback.rollbackTo("implementation", "Second rollback")
      rollback.rollbackTo("review", "Third rollback")

      const history = rollback.getHistory()
      expect(history).toHaveLength(3)
    })

    it("should clear history when requested", () => {
      rollback.rollbackTo("planning", "Test")
      rollback.clearHistory()

      expect(rollback.getHistory()).toHaveLength(0)
    })
  })
})

import { describe, it, expect, beforeEach } from "bun:test"
import {
  evaluateSession,
  storeEvaluation,
  getAgentScore,
  getBestAgentForCategory,
  getEvaluationStats,
  clearAllEvaluations,
  calculateOverallScore,
} from "./index"

describe("auto-evaluation", () => {
  beforeEach(() => {
    clearAllEvaluations()
  })

  describe("#given empty evaluations", () => {
    it("#then getEvaluationStats returns zeros", () => {
      const stats = getEvaluationStats()
      expect(stats.totalEvaluations).toBe(0)
      expect(stats.averageOverallScore).toBe(0)
    })

    it("#then getAgentScore returns zeros", () => {
      const score = getAgentScore("sisyphus")
      expect(score.averageScore).toBe(0)
      expect(score.totalEvaluations).toBe(0)
    })

    it("#then getBestAgentForCategory returns null", () => {
      const best = getBestAgentForCategory("orchestration")
      expect(best).toBeNull()
    })
  })

  describe("#given session evaluation", () => {
    it("#then evaluateSession calculates correct scores", () => {
      const evaluation = evaluateSession(
        "session-1",
        "sisyphus",
        {
          toolCallsCount: 10,
          successfulToolCalls: 8,
          failedToolCalls: 2,
          durationMs: 3 * 60 * 1000, // 3 minutes
          tokenUsage: 5000,
          errorCount: 1,
          retryCount: 0,
          todosCompleted: 5,
          todosTotal: 5,
        },
        {
          category: "orchestration",
          taskDescription: "Implement authentication system",
        },
      )

      expect(evaluation.agentName).toBe("sisyphus")
      expect(evaluation.completionScore).toBe(100)
      expect(evaluation.overallScore).toBeGreaterThan(0)
      expect(evaluation.overallScore).toBeLessThanOrEqual(100)
      expect(evaluation.completionStatus).toBe("completed")
    })

    it("#then evaluateSession penalizes errors", () => {
      const evaluation = evaluateSession(
        "session-2",
        "atlas",
        {
          toolCallsCount: 20,
          successfulToolCalls: 10,
          failedToolCalls: 10,
          durationMs: 15 * 60 * 1000, // 15 minutes
          tokenUsage: 10000,
          errorCount: 8,
          retryCount: 5,
          todosCompleted: 2,
          todosTotal: 10,
        },
      )

      expect(evaluation.qualityScore).toBeLessThan(50)
      expect(evaluation.efficiencyScore).toBeLessThan(70)
      expect(evaluation.completionStatus).toBe("failed")
    })

    it("#then calculateOverallScore uses correct weights", () => {
      const score = calculateOverallScore(
        {
          completionScore: 100,
          efficiencyScore: 80,
          qualityScore: 90,
          toolUsageScore: 85,
        },
        {
          completionWeight: 0.4,
          efficiencyWeight: 0.3,
          qualityWeight: 0.2,
          toolUsageWeight: 0.1,
        },
      )

      // 100*0.4 + 80*0.3 + 90*0.2 + 85*0.1 = 40 + 24 + 18 + 8.5 = 90.5
      expect(score).toBe(90.5)
    })
  })

  describe("#given stored evaluations", () => {
    beforeEach(() => {
      // Store multiple evaluations for sisyphus with LOW scores
      for (let i = 0; i < 5; i++) {
        const eval_ = evaluateSession(
          `session-${i}`,
          "sisyphus",
          {
            toolCallsCount: 20,
            successfulToolCalls: 10,
            failedToolCalls: 10,
            durationMs: 15 * 60 * 1000,
            tokenUsage: 10000,
            errorCount: 5,
            retryCount: 3,
            todosCompleted: 2,
            todosTotal: 10,
          },
          { category: "orchestration" },
        )
        // Ensure ordering with older timestamps
        eval_.evaluatedAt = new Date(Date.now() - (10 - i) * 1000)
        storeEvaluation(eval_)
      }

      // Store evaluations for oracle
      for (let i = 0; i < 2; i++) {
        const eval_ = evaluateSession(
          `session-oracle-${i}`,
          "oracle",
          {
            toolCallsCount: 5,
            successfulToolCalls: 5,
            failedToolCalls: 0,
            durationMs: 2 * 60 * 1000,
            tokenUsage: 2000,
            errorCount: 0,
            retryCount: 0,
            todosCompleted: 3,
            todosTotal: 3,
          },
          { category: "analysis" },
        )
        eval_.evaluatedAt = new Date(Date.now() - (5 - i) * 1000)
        storeEvaluation(eval_)
      }
    })

    it("#then getAgentScore returns correct average", () => {
      const score = getAgentScore("sisyphus")
      expect(score.totalEvaluations).toBe(5)
      expect(score.averageScore).toBeGreaterThan(0)
    })

    it("#then getBestAgentForCategory returns best agent", () => {
      const best = getBestAgentForCategory("orchestration")
      expect(best).not.toBeNull()
      expect(best?.agentName).toBe("sisyphus")
    })

    it("#then getEvaluationStats returns correct totals", () => {
      const stats = getEvaluationStats()
      expect(stats.totalEvaluations).toBe(7)
      expect(stats.byAgent["sisyphus"].count).toBe(5)
      expect(stats.byAgent["oracle"].count).toBe(2)
      expect(stats.byCategory["orchestration"].count).toBe(5)
      expect(stats.byCategory["analysis"].count).toBe(2)
    })

    it("#then getAgentScore detects improving trend", async () => {
      // Add more recent high-scoring evaluations with delays
      for (let i = 0; i < 5; i++) {
        const eval_ = evaluateSession(
          `session-recent-${i}`,
          "sisyphus",
          {
            toolCallsCount: 10,
            successfulToolCalls: 10,
            failedToolCalls: 0,
            durationMs: 2 * 60 * 1000,
            tokenUsage: 2000,
            errorCount: 0,
            retryCount: 0,
            todosCompleted: 5,
            todosTotal: 5,
          },
        )
        // Override evaluatedAt to ensure ordering
        eval_.evaluatedAt = new Date(Date.now() + i * 1000)
        storeEvaluation(eval_)
      }

      const score = getAgentScore("sisyphus")
      expect(score.recentTrend).toBe("improving")
    })
  })
})

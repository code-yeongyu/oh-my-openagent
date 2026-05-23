import { describe, it, expect, beforeEach } from "bun:test"
import {
  recordEvaluation,
  getAgentScore,
  getEvaluationMetrics,
  getRecentEvaluations,
  clearEvaluations,
} from "./evaluator"
import { getEvaluationDb } from "./storage"

describe("Auto Evaluation", () => {
  beforeEach(() => {
    clearEvaluations("all")
  })

  describe("#given a clean database", () => {
    it("should record an evaluation", () => {
      // given
      const evaluation = {
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "quick",
        taskDescription: "Test task",
        metrics: {
          completionRate: 1,
          toolCallEfficiency: 0.8,
          responseQuality: 0.9,
          errorCount: 0,
          totalToolCalls: 5,
          durationMs: 10000,
        },
        modelUsed: "kimi-k2.6",
      }

      // when
      const id = recordEvaluation(evaluation)

      // then
      expect(id).toBeDefined()
      expect(id).toContain("eval-")
    })

    it("should get agent score", () => {
      // given
      recordEvaluation({
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "quick",
        taskDescription: "Test task 1",
        metrics: {
          completionRate: 1,
          toolCallEfficiency: 0.8,
          responseQuality: 0.9,
          errorCount: 0,
          totalToolCalls: 5,
          durationMs: 10000,
        },
        modelUsed: "kimi-k2.6",
      })

      // when
      const score = getAgentScore("sisyphus")

      // then
      expect(score).toBeDefined()
      expect(score.totalEvaluations).toBe(1)
      expect(score.averageScore).toBeGreaterThan(0)
    })

    it("should get evaluation metrics", () => {
      // given
      recordEvaluation({
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "quick",
        taskDescription: "Test task 1",
        metrics: {
          completionRate: 1,
          toolCallEfficiency: 0.8,
          responseQuality: 0.9,
          errorCount: 0,
          totalToolCalls: 5,
          durationMs: 10000,
        },
        modelUsed: "kimi-k2.6",
      })

      recordEvaluation({
        sessionId: "session-2",
        agentName: "sisyphus",
        category: "quick",
        taskDescription: "Test task 2",
        metrics: {
          completionRate: 0.5,
          toolCallEfficiency: 0.4,
          responseQuality: 0.6,
          errorCount: 2,
          totalToolCalls: 10,
          durationMs: 20000,
        },
        modelUsed: "kimi-k2.6",
      })

      // when
      const metrics = getEvaluationMetrics()

      // then
      expect(metrics.totalEvaluations).toBe(2)
      expect(metrics.averageScore).toBeGreaterThan(0)
      expect(metrics.byAgent.sisyphus).toBeDefined()
    })

    it("should get recent evaluations", () => {
      // given
      recordEvaluation({
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "quick",
        taskDescription: "Test task 1",
        metrics: {
          completionRate: 1,
          toolCallEfficiency: 0.8,
          responseQuality: 0.9,
          errorCount: 0,
          totalToolCalls: 5,
          durationMs: 10000,
        },
        modelUsed: "kimi-k2.6",
      })

      // when
      const evaluations = getRecentEvaluations(5)

      // then
      expect(evaluations.length).toBe(1)
      expect(evaluations[0].agentName).toBe("sisyphus")
    })

    it("should clear evaluations", () => {
      // given
      recordEvaluation({
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "quick",
        taskDescription: "Test task 1",
        metrics: {
          completionRate: 1,
          toolCallEfficiency: 0.8,
          responseQuality: 0.9,
          errorCount: 0,
          totalToolCalls: 5,
          durationMs: 10000,
        },
        modelUsed: "kimi-k2.6",
      })

      // when
      clearEvaluations("all")

      // then
      const evaluations = getRecentEvaluations(10)
      expect(evaluations.length).toBe(0)
    })
  })
})

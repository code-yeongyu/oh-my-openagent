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
      const evaluation = recordEvaluation("session-1", "sisyphus", {
        completionScore: 1,
        qualityScore: 0.9,
        efficiencyScore: 0.8,
        errorCount: 0,
        toolCallCount: 5,
        durationMs: 10000,
        todosCompleted: 3,
        todosTotal: 3,
        category: "quick",
        taskDescription: "Test task",
      })

      expect(evaluation.id).toBeDefined()
      expect(evaluation.agentName).toBe("sisyphus")
      expect(evaluation.completionScore).toBe(1)
    })

    it("should get agent score", () => {
      recordEvaluation("session-1", "sisyphus", {
        completionScore: 1,
        qualityScore: 0.9,
        efficiencyScore: 0.8,
        errorCount: 0,
        toolCallCount: 5,
        durationMs: 10000,
        todosCompleted: 3,
        todosTotal: 3,
        category: "quick",
        taskDescription: "Test task 1",
      })

      const score = getAgentScore("sisyphus")

      expect(score).not.toBeNull()
      expect(score!.metrics.totalEvaluations).toBe(1)
      expect(score!.overallScore).toBeGreaterThan(0)
    })

    it("should get evaluation metrics", () => {
      recordEvaluation("session-1", "sisyphus", {
        completionScore: 1,
        qualityScore: 0.9,
        efficiencyScore: 0.8,
        errorCount: 0,
        toolCallCount: 5,
        durationMs: 10000,
        todosCompleted: 3,
        todosTotal: 3,
        category: "quick",
        taskDescription: "Test task 1",
      })

      recordEvaluation("session-2", "sisyphus", {
        completionScore: 0.5,
        qualityScore: 0.4,
        efficiencyScore: 0.6,
        errorCount: 2,
        toolCallCount: 10,
        durationMs: 20000,
        todosCompleted: 1,
        todosTotal: 3,
        category: "quick",
        taskDescription: "Test task 2",
      })

      const metrics = getEvaluationMetrics()

      expect(metrics.totalEvaluations).toBe(2)
      expect(metrics.avgCompletionScore).toBeGreaterThan(0)
    })

    it("should get recent evaluations", () => {
      recordEvaluation("session-1", "sisyphus", {
        completionScore: 1,
        qualityScore: 0.9,
        efficiencyScore: 0.8,
        errorCount: 0,
        toolCallCount: 5,
        durationMs: 10000,
        todosCompleted: 3,
        todosTotal: 3,
        category: "quick",
        taskDescription: "Test task 1",
      })

      const evaluations = getRecentEvaluations(5)

      expect(evaluations.length).toBe(1)
      expect(evaluations[0].agentName).toBe("sisyphus")
    })

    it("should clear evaluations", () => {
      recordEvaluation("session-1", "sisyphus", {
        completionScore: 1,
        qualityScore: 0.9,
        efficiencyScore: 0.8,
        errorCount: 0,
        toolCallCount: 5,
        durationMs: 10000,
        todosCompleted: 3,
        todosTotal: 3,
        category: "quick",
        taskDescription: "Test task 1",
      })

      clearEvaluations("all")

      const evaluations = getRecentEvaluations(10)
      expect(evaluations.length).toBe(0)
    })
  })
})

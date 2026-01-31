/**
 * Session Quality Scorer Tests
 *
 * Tests for session quality evaluation based on test coverage, code quality, and task completion
 */

import { describe, it, expect, beforeEach } from "bun:test"
import {
  SessionScorer,
  createSessionScorer,
  QualityGrade,
  type SessionMetrics,
} from "./index"

describe("SessionScorer", () => {
  let scorer: SessionScorer

  beforeEach(() => {
    scorer = createSessionScorer()
  })

  describe("initial state", () => {
    //#given a new scorer instance
    //#when getting the initial score
    //#then it should return 0
    it("should return 0 as initial score", () => {
      expect(scorer.getScore()).toBe(0)
    })

    it("should return grade N/A initially", () => {
      expect(scorer.getGrade()).toBe(QualityGrade.NA)
    })
  })

  describe("test coverage score", () => {
    //#given session with modified files and corresponding tests
    //#when calculating test coverage score
    //#then it should return correct percentage
    it("should calculate test coverage score correctly", () => {
      const metrics: SessionMetrics = {
        modifiedFiles: 5,
        filesWithTests: 4,
        lintErrors: 0,
        typeErrors: 0,
        tasksCompleted: 10,
        tasksTotal: 10,
      }

      scorer.updateMetrics(metrics)
      
      // Test coverage is 4/5 = 80% = 80 points (out of 100 for this category)
      // With weight of 0.4, contribution = 32
      expect(scorer.getTestCoverageScore()).toBe(80)
    })

    it("should return 100 when all files have tests", () => {
      const metrics: SessionMetrics = {
        modifiedFiles: 5,
        filesWithTests: 5,
        lintErrors: 0,
        typeErrors: 0,
        tasksCompleted: 10,
        tasksTotal: 10,
      }

      scorer.updateMetrics(metrics)
      expect(scorer.getTestCoverageScore()).toBe(100)
    })

    it("should return 0 when no files have tests", () => {
      const metrics: SessionMetrics = {
        modifiedFiles: 5,
        filesWithTests: 0,
        lintErrors: 0,
        typeErrors: 0,
        tasksCompleted: 10,
        tasksTotal: 10,
      }

      scorer.updateMetrics(metrics)
      expect(scorer.getTestCoverageScore()).toBe(0)
    })
  })

  describe("code quality score", () => {
    //#given session with lint and type errors
    //#when calculating code quality score
    //#then it should penalize for errors
    it("should return 100 with no errors", () => {
      const metrics: SessionMetrics = {
        modifiedFiles: 5,
        filesWithTests: 5,
        lintErrors: 0,
        typeErrors: 0,
        tasksCompleted: 10,
        tasksTotal: 10,
      }

      scorer.updateMetrics(metrics)
      expect(scorer.getCodeQualityScore()).toBe(100)
    })

    it("should penalize for lint errors", () => {
      const metrics: SessionMetrics = {
        modifiedFiles: 5,
        filesWithTests: 5,
        lintErrors: 5,
        typeErrors: 0,
        tasksCompleted: 10,
        tasksTotal: 10,
      }

      scorer.updateMetrics(metrics)
      // Each lint error = -2 points, 5 errors = -10
      expect(scorer.getCodeQualityScore()).toBe(90)
    })

    it("should penalize more heavily for type errors", () => {
      const metrics: SessionMetrics = {
        modifiedFiles: 5,
        filesWithTests: 5,
        lintErrors: 0,
        typeErrors: 5,
        tasksCompleted: 10,
        tasksTotal: 10,
      }

      scorer.updateMetrics(metrics)
      // Each type error = -5 points, 5 errors = -25
      expect(scorer.getCodeQualityScore()).toBe(75)
    })

    it("should not go below 0", () => {
      const metrics: SessionMetrics = {
        modifiedFiles: 5,
        filesWithTests: 5,
        lintErrors: 100,
        typeErrors: 100,
        tasksCompleted: 10,
        tasksTotal: 10,
      }

      scorer.updateMetrics(metrics)
      expect(scorer.getCodeQualityScore()).toBe(0)
    })
  })

  describe("task completion score", () => {
    //#given session with completed and total tasks
    //#when calculating task completion score
    //#then it should return correct percentage
    it("should calculate task completion correctly", () => {
      const metrics: SessionMetrics = {
        modifiedFiles: 5,
        filesWithTests: 5,
        lintErrors: 0,
        typeErrors: 0,
        tasksCompleted: 8,
        tasksTotal: 10,
      }

      scorer.updateMetrics(metrics)
      expect(scorer.getTaskCompletionScore()).toBe(80)
    })

    it("should return 100 when all tasks completed", () => {
      const metrics: SessionMetrics = {
        modifiedFiles: 5,
        filesWithTests: 5,
        lintErrors: 0,
        typeErrors: 0,
        tasksCompleted: 10,
        tasksTotal: 10,
      }

      scorer.updateMetrics(metrics)
      expect(scorer.getTaskCompletionScore()).toBe(100)
    })
  })

  describe("overall score and grade", () => {
    it("should calculate weighted overall score", () => {
      const metrics: SessionMetrics = {
        modifiedFiles: 5,
        filesWithTests: 5, // 100% coverage
        lintErrors: 0,
        typeErrors: 0, // 100% quality
        tasksCompleted: 10,
        tasksTotal: 10, // 100% completion
      }

      scorer.updateMetrics(metrics)
      // All 100 = overall 100
      expect(scorer.getScore()).toBe(100)
    })

    it("should return grade A for score >= 90", () => {
      const metrics: SessionMetrics = {
        modifiedFiles: 5,
        filesWithTests: 5,
        lintErrors: 0,
        typeErrors: 0,
        tasksCompleted: 10,
        tasksTotal: 10,
      }

      scorer.updateMetrics(metrics)
      expect(scorer.getGrade()).toBe(QualityGrade.A)
    })

    it("should return grade B for score >= 80", () => {
      // Target: 80-89 score
      // With 80% coverage (32), 100% quality (30), 100% completion (30) = 92 (A)
      // Need lower: 70% coverage (28), 100% quality (30), 100% completion (30) = 88 (B)
      const metrics: SessionMetrics = {
        modifiedFiles: 10,
        filesWithTests: 7, // 70% coverage = 28 weighted
        lintErrors: 0,
        typeErrors: 0, // 100% quality = 30 weighted
        tasksCompleted: 10,
        tasksTotal: 10, // 100% completion = 30 weighted
      }

      scorer.updateMetrics(metrics)
      expect(scorer.getGrade()).toBe(QualityGrade.B)
    })

    it("should return grade C for score >= 70", () => {
      // Target: 70-79 score
      // 50% coverage (20), 90% quality (27), 100% completion (30) = 77 (C)
      const metrics: SessionMetrics = {
        modifiedFiles: 10,
        filesWithTests: 5, // 50% coverage = 20 weighted
        lintErrors: 5, // -10 = 90% quality = 27 weighted
        typeErrors: 0,
        tasksCompleted: 10,
        tasksTotal: 10, // 100% completion = 30 weighted
      }

      scorer.updateMetrics(metrics)
      expect(scorer.getGrade()).toBe(QualityGrade.C)
    })

    it("should return grade D for score >= 60", () => {
      const metrics: SessionMetrics = {
        modifiedFiles: 5,
        filesWithTests: 2, // 40% coverage
        lintErrors: 10, // -20 quality
        typeErrors: 0,
        tasksCompleted: 8,
        tasksTotal: 10, // 80% completion
      }

      scorer.updateMetrics(metrics)
      expect(scorer.getGrade()).toBe(QualityGrade.D)
    })

    it("should return grade F for score < 60", () => {
      const metrics: SessionMetrics = {
        modifiedFiles: 5,
        filesWithTests: 1, // 20% coverage
        lintErrors: 20, // -40 quality
        typeErrors: 5, // -25 quality
        tasksCompleted: 5,
        tasksTotal: 10, // 50% completion
      }

      scorer.updateMetrics(metrics)
      expect(scorer.getGrade()).toBe(QualityGrade.F)
    })
  })

  describe("display format", () => {
    it("should format score display correctly", () => {
      const metrics: SessionMetrics = {
        modifiedFiles: 5,
        filesWithTests: 5,
        lintErrors: 0,
        typeErrors: 0,
        tasksCompleted: 9,
        tasksTotal: 10,
      }

      scorer.updateMetrics(metrics)
      const display = scorer.getDisplayString()
      expect(display).toContain("会话质量")
      expect(display).toMatch(/[A-F]/)
      expect(display).toMatch(/\d+\/100/)
    })
  })

  describe("no code changes", () => {
    //#given no code modifications in session
    //#when getting score
    //#then it should skip scoring
    it("should return N/A grade when no files modified", () => {
      const metrics: SessionMetrics = {
        modifiedFiles: 0,
        filesWithTests: 0,
        lintErrors: 0,
        typeErrors: 0,
        tasksCompleted: 0,
        tasksTotal: 0,
      }

      scorer.updateMetrics(metrics)
      expect(scorer.getGrade()).toBe(QualityGrade.NA)
    })
  })

  describe("reset", () => {
    it("should reset all metrics", () => {
      const metrics: SessionMetrics = {
        modifiedFiles: 5,
        filesWithTests: 5,
        lintErrors: 0,
        typeErrors: 0,
        tasksCompleted: 10,
        tasksTotal: 10,
      }

      scorer.updateMetrics(metrics)
      expect(scorer.getScore()).toBe(100)

      scorer.reset()
      expect(scorer.getScore()).toBe(0)
      expect(scorer.getGrade()).toBe(QualityGrade.NA)
    })
  })
})

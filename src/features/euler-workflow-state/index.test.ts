import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "fs"
import { join } from "path"
import {
  loadWorkflowState,
  saveWorkflowState,
  resetWorkflowState,
  isValidPhaseTransition,
  transitionPhase,
  parseReviewFile,
  validatePhasePrerequisites,
  type WorkflowState,
  WORKFLOW_STATE_DIR,
} from "./index"

const TEST_DIR = join(process.cwd(), "test-workflow-state")

describe("euler-workflow-state", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
  })

  describe("loadWorkflowState", () => {
    it("should return default state when no state file exists", () => {
      const state = loadWorkflowState(TEST_DIR)

      expect(state.phase).toBe("idle")
      expect(state.reviewIterations).toBe(0)
      expect(state.lastUpdated).toBeDefined()
    })

    it("should load existing state from file", () => {
      const expectedState: WorkflowState = {
        phase: "planning",
        lastUpdated: new Date().toISOString(),
        reviewIterations: 1,
        planFile: ".agentic-loop/plans/test.md",
      }

      saveWorkflowState(TEST_DIR, expectedState)
      const loadedState = loadWorkflowState(TEST_DIR)

      expect(loadedState.phase).toBe("planning")
      expect(loadedState.reviewIterations).toBe(1)
      expect(loadedState.planFile).toBe(".agentic-loop/plans/test.md")
    })
  })

  describe("saveWorkflowState", () => {
    it("should create state file with correct structure", () => {
      const state: WorkflowState = {
        phase: "reviewing",
        lastUpdated: "",
        reviewIterations: 0,
        planFile: "plans/test.md",
        reviewFile: "reviews/test-review.md",
      }

      saveWorkflowState(TEST_DIR, state)

      const statePath = join(TEST_DIR, WORKFLOW_STATE_DIR, "workflow-state.json")
      expect(existsSync(statePath)).toBe(true)

      const savedContent = readFileSync(statePath, "utf-8")
      const parsed = JSON.parse(savedContent)

      expect(parsed.phase).toBe("reviewing")
      expect(parsed.planFile).toBe("plans/test.md")
      expect(parsed.reviewFile).toBe("reviews/test-review.md")
      expect(parsed.lastUpdated).toBeDefined()
    })
  })

  describe("resetWorkflowState", () => {
    it("should reset state to idle", () => {
      const state: WorkflowState = {
        phase: "executing",
        lastUpdated: new Date().toISOString(),
        reviewIterations: 2,
        planFile: "plans/test.md",
      }

      saveWorkflowState(TEST_DIR, state)
      resetWorkflowState(TEST_DIR)

      const loadedState = loadWorkflowState(TEST_DIR)
      expect(loadedState.phase).toBe("idle")
      expect(loadedState.reviewIterations).toBe(0)
      expect(loadedState.planFile).toBeUndefined()
    })
  })

  describe("isValidPhaseTransition", () => {
    it("should allow valid transitions from idle", () => {
      expect(isValidPhaseTransition("idle", "planning")).toBe(true)
      expect(isValidPhaseTransition("idle", "reviewing")).toBe(false)
    })

    it("should allow valid transitions from planning", () => {
      expect(isValidPhaseTransition("planning", "reviewing")).toBe(true)
      expect(isValidPhaseTransition("planning", "failed")).toBe(true)
      expect(isValidPhaseTransition("planning", "executing")).toBe(false)
    })

    it("should allow valid transitions from reviewing", () => {
      expect(isValidPhaseTransition("reviewing", "executing")).toBe(true)
      expect(isValidPhaseTransition("reviewing", "planning")).toBe(true)
      expect(isValidPhaseTransition("reviewing", "failed")).toBe(true)
    })

    it("should allow valid transitions from executing", () => {
      expect(isValidPhaseTransition("executing", "deploying")).toBe(true)
      expect(isValidPhaseTransition("executing", "failed")).toBe(true)
    })

    it("should allow retry from failed", () => {
      expect(isValidPhaseTransition("failed", "planning")).toBe(true)
    })
  })

  describe("transitionPhase", () => {
    it("should transition to valid phase", () => {
      const newState = transitionPhase(TEST_DIR, "planning", {
        planFile: ".agentic-loop/plans/test.md",
      })

      expect(newState.phase).toBe("planning")
      expect(newState.planFile).toBe(".agentic-loop/plans/test.md")
    })

    it("should throw error for invalid transition", () => {
      transitionPhase(TEST_DIR, "planning")

      expect(() => {
        transitionPhase(TEST_DIR, "testing")
      }).toThrow("Invalid phase transition: planning → testing")
    })
  })

  describe("parseReviewFile", () => {
    it("should parse APPROVE verdict", () => {
      const content = `
## Review

**Verdict**: APPROVE

**Score**: 32/40

### Critical Issues
- None
      `

      const result = parseReviewFile(content)

      expect(result.verdict).toBe("APPROVE")
      expect(result.score).toBe(32)
      expect(result.maxScore).toBe(40)
    })

    it("should parse REJECT verdict with critical issues", () => {
      const content = `
## Review

**Verdict**: REJECT

**Score**: 25/40

### Critical Issues
- Missing error handling
- Database schema incomplete
      `

      const result = parseReviewFile(content)

      expect(result.verdict).toBe("REJECT")
      expect(result.score).toBe(25)
      expect(result.criticalIssues).toContain("Missing error handling")
      expect(result.criticalIssues).toContain("Database schema incomplete")
    })

    it("should handle missing verdict", () => {
      const content = "No verdict here"

      const result = parseReviewFile(content)

      expect(result.verdict).toBeNull()
      expect(result.score).toBe(0)
    })
  })

  describe("validatePhasePrerequisites", () => {
    it("should pass validation for planning phase", () => {
      const result = validatePhasePrerequisites(TEST_DIR, "planning")

      expect(result.valid).toBe(true)
      expect(result.missing).toHaveLength(0)
    })

    it("should fail validation for reviewing without plan file", () => {
      const state: WorkflowState = {
        phase: "planning",
        lastUpdated: new Date().toISOString(),
        reviewIterations: 0,
        planFile: ".agentic-loop/plans/test.md",
      }

      saveWorkflowState(TEST_DIR, state)
      const result = validatePhasePrerequisites(TEST_DIR, "reviewing")

      expect(result.valid).toBe(false)
      expect(result.missing).toContain(".agentic-loop/plans/test.md")
    })

    it("should pass validation for reviewing with plan file", () => {
      const planDir = join(TEST_DIR, ".agentic-loop", "plans")
      mkdirSync(planDir, { recursive: true })
      writeFileSync(join(planDir, "test.md"), "# Plan")

      const state: WorkflowState = {
        phase: "planning",
        lastUpdated: new Date().toISOString(),
        reviewIterations: 0,
        planFile: ".agentic-loop/plans/test.md",
      }

      saveWorkflowState(TEST_DIR, state)
      const result = validatePhasePrerequisites(TEST_DIR, "reviewing")

      expect(result.valid).toBe(true)
    })

    it("should fail validation for executing without review approval", () => {
      const planDir = join(TEST_DIR, ".agentic-loop", "plans")
      const reviewDir = join(TEST_DIR, ".agentic-loop", "reviews")
      mkdirSync(planDir, { recursive: true })
      mkdirSync(reviewDir, { recursive: true })

      writeFileSync(join(planDir, "test.md"), "# Plan")
      writeFileSync(
        join(reviewDir, "test-review.md"),
        "## Review\n\n**Verdict**: REJECT\n**Score**: 25/40"
      )

      const state: WorkflowState = {
        phase: "reviewing",
        lastUpdated: new Date().toISOString(),
        reviewIterations: 1,
        planFile: ".agentic-loop/plans/test.md",
        reviewFile: ".agentic-loop/reviews/test-review.md",
      }

      saveWorkflowState(TEST_DIR, state)
      const result = validatePhasePrerequisites(TEST_DIR, "executing")

      expect(result.valid).toBe(false)
      expect(result.missing).toContain("Review approval (score >= 30, no critical issues)")
    })

    it("should pass validation for executing with approved review", () => {
      const planDir = join(TEST_DIR, ".agentic-loop", "plans")
      const reviewDir = join(TEST_DIR, ".agentic-loop", "reviews")
      mkdirSync(planDir, { recursive: true })
      mkdirSync(reviewDir, { recursive: true })

      writeFileSync(join(planDir, "test.md"), "# Plan")
      writeFileSync(
        join(reviewDir, "test-review.md"),
        "## Review\n\n**Verdict**: APPROVE\n**Score**: 35/40"
      )

      const state: WorkflowState = {
        phase: "reviewing",
        lastUpdated: new Date().toISOString(),
        reviewIterations: 1,
        planFile: ".agentic-loop/plans/test.md",
        reviewFile: ".agentic-loop/reviews/test-review.md",
      }

      saveWorkflowState(TEST_DIR, state)
      const result = validatePhasePrerequisites(TEST_DIR, "executing")

      expect(result.valid).toBe(true)
    })
  })
})


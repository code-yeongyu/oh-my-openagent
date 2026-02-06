import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { readState, writeState, clearState, incrementIteration } from "./storage"
import type { ReviewLoopState } from "./types"

describe("review-loop storage", () => {
  const TEST_DIR = join(tmpdir(), "review-loop-test-" + Date.now())

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
    clearState(TEST_DIR)
  })

  afterEach(() => {
    clearState(TEST_DIR)
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe("readState", () => {
    test("should parse target_branch from frontmatter YAML", () => {
      //#given - a state file with target_branch in frontmatter
      const state: ReviewLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR against dev",
        target_branch: "dev",
        pr_files: ["src/file1.ts", "src/file2.ts"],
      }
      writeState(TEST_DIR, state)

      //#when - read state
      const result = readState(TEST_DIR)

      //#then - target_branch should be parsed correctly
      expect(result).not.toBeNull()
      expect(result?.target_branch).toBe("dev")
    })

    test("should parse pr_files as YAML array from frontmatter", () => {
      //#given - a state file with pr_files array
      const state: ReviewLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR",
        target_branch: "main",
        pr_files: ["src/hooks/review-loop/index.ts", "src/hooks/review-loop/storage.ts", "src/hooks/review-loop/types.ts"],
      }
      writeState(TEST_DIR, state)

      //#when - read state
      const result = readState(TEST_DIR)

      //#then - pr_files should be parsed as array
      expect(result).not.toBeNull()
      expect(Array.isArray(result?.pr_files)).toBe(true)
      expect(result?.pr_files).toEqual(["src/hooks/review-loop/index.ts", "src/hooks/review-loop/storage.ts", "src/hooks/review-loop/types.ts"])
    })

    test("should return null for non-existent state file", () => {
      //#given - no state file exists
      //#when - read state
      const result = readState(TEST_DIR)

      //#then - should return null
      expect(result).toBeNull()
    })

    test("should handle empty pr_files array", () => {
      //#given - state with empty pr_files
      const state: ReviewLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR",
        target_branch: "dev",
        pr_files: [],
      }
      writeState(TEST_DIR, state)

      //#when - read state
      const result = readState(TEST_DIR)

      //#then - pr_files should be empty array
      expect(result?.pr_files).toEqual([])
    })
  })

  describe("writeState", () => {
    test("should serialize pr_files as YAML array in frontmatter", () => {
      //#given - a state with pr_files
      const state: ReviewLoopState = {
        active: true,
        iteration: 2,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR against dev",
        target_branch: "dev",
        pr_files: ["src/file1.ts", "src/file2.ts"],
      }

      //#when - write state
      const success = writeState(TEST_DIR, state)

      //#then - write should succeed
      expect(success).toBe(true)

      //#then - file should contain pr_files as YAML array
      const filePath = join(TEST_DIR, ".sisyphus/review-loop.local.md")
      const content = require("node:fs").readFileSync(filePath, "utf-8")
      expect(content).toContain("pr_files:")
      expect(content).toContain("- src/file1.ts")
      expect(content).toContain("- src/file2.ts")
    })

    test("should include target_branch in frontmatter", () => {
      //#given - a state with target_branch
      const state: ReviewLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR",
        target_branch: "main",
        pr_files: ["src/file1.ts"],
      }

      //#when - write state
      writeState(TEST_DIR, state)

      //#then - file should contain target_branch
      const filePath = join(TEST_DIR, ".sisyphus/review-loop.local.md")
      const content = require("node:fs").readFileSync(filePath, "utf-8")
      expect(content).toContain("target_branch: main")
    })

    test("should write to .sisyphus/review-loop.local.md by default", () => {
      //#given - a state
      const state: ReviewLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR",
        target_branch: "dev",
        pr_files: [],
      }

      //#when - write state
      writeState(TEST_DIR, state)

      //#then - file should exist at correct path
      const filePath = join(TEST_DIR, ".sisyphus/review-loop.local.md")
      expect(existsSync(filePath)).toBe(true)
    })

    test("should create parent directories if they don't exist", () => {
      //#given - a state and non-existent parent directory
      const state: ReviewLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR",
        target_branch: "dev",
        pr_files: [],
      }

      //#when - write state
      const success = writeState(TEST_DIR, state)

      //#then - should succeed and create directories
      expect(success).toBe(true)
      const filePath = join(TEST_DIR, ".sisyphus/review-loop.local.md")
      expect(existsSync(filePath)).toBe(true)
    })
  })

  describe("clearState", () => {
    test("should delete state file", () => {
      //#given - existing state file
      const state: ReviewLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR",
        target_branch: "dev",
        pr_files: [],
      }
      writeState(TEST_DIR, state)

      //#when - clear state
      const success = clearState(TEST_DIR)

      //#then - should succeed and file should not exist
      expect(success).toBe(true)
      expect(readState(TEST_DIR)).toBeNull()
    })

    test("should return true even if file doesn't exist", () => {
      //#given - no state file
      //#when - clear state
      const success = clearState(TEST_DIR)

      //#then - should return true
      expect(success).toBe(true)
    })
  })

  describe("incrementIteration", () => {
    test("should increment iteration and persist to file", () => {
      //#given - existing state with iteration 1
      const state: ReviewLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR",
        target_branch: "dev",
        pr_files: ["src/file1.ts"],
      }
      writeState(TEST_DIR, state)

      //#when - increment iteration
      const result = incrementIteration(TEST_DIR)

      //#then - should return state with iteration 2
      expect(result).not.toBeNull()
      expect(result?.iteration).toBe(2)

      //#then - persisted state should also have iteration 2
      const readBack = readState(TEST_DIR)
      expect(readBack?.iteration).toBe(2)
    })

    test("should return null if no state exists", () => {
      //#given - no state file
      //#when - increment iteration
      const result = incrementIteration(TEST_DIR)

      //#then - should return null
      expect(result).toBeNull()
    })

    test("should preserve all other fields when incrementing", () => {
      //#given - state with all fields
      const state: ReviewLoopState = {
        active: true,
        iteration: 3,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR against dev",
        session_id: "ses_123",
        target_branch: "dev",
        pr_files: ["src/file1.ts", "src/file2.ts"],
      }
      writeState(TEST_DIR, state)

      //#when - increment iteration
      const result = incrementIteration(TEST_DIR)

      //#then - all fields should be preserved except iteration
      expect(result?.active).toBe(true)
      expect(result?.max_iterations).toBe(10)
      expect(result?.completion_promise).toBe("REVIEW_COMPLETE")
      expect(result?.started_at).toBe("2026-02-06T15:00:00Z")
      expect(result?.prompt).toBe("Review PR against dev")
      expect(result?.session_id).toBe("ses_123")
      expect(result?.target_branch).toBe("dev")
      expect(result?.pr_files).toEqual(["src/file1.ts", "src/file2.ts"])
    })
  })
})

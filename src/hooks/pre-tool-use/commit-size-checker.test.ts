/**
 * Commit Size Checker Tests
 *
 * Tests for enforcing atomic commits by checking file count
 */

import { describe, it, expect, beforeEach } from "bun:test"
import {
  CommitSizeChecker,
  createCommitSizeChecker,
  type CommitCheckResult,
} from "./commit-size-checker"

describe("CommitSizeChecker", () => {
  let checker: CommitSizeChecker

  beforeEach(() => {
    checker = createCommitSizeChecker()
  })

  describe("file count check", () => {
    //#given commit with 4+ files
    //#when checking commit size
    //#then should trigger warning
    it("should warn when commit has more than 3 files", () => {
      const result = checker.check({
        files: ["file1.ts", "file2.ts", "file3.ts", "file4.ts"],
      })

      expect(result.shouldWarn).toBe(true)
      expect(result.message).toContain("4")
    })

    //#given commit with 3 or fewer files
    //#when checking commit size
    //#then should pass silently
    it("should pass silently with 3 or fewer files", () => {
      const result = checker.check({
        files: ["file1.ts", "file2.ts", "file3.ts"],
      })

      expect(result.shouldWarn).toBe(false)
    })

    it("should pass with single file", () => {
      const result = checker.check({
        files: ["file1.ts"],
      })

      expect(result.shouldWarn).toBe(false)
    })
  })

  describe("configurable threshold", () => {
    it("should allow custom threshold", () => {
      checker.setThreshold(5)

      const result = checker.check({
        files: ["f1.ts", "f2.ts", "f3.ts", "f4.ts", "f5.ts"],
      })

      expect(result.shouldWarn).toBe(false)

      const result2 = checker.check({
        files: ["f1.ts", "f2.ts", "f3.ts", "f4.ts", "f5.ts", "f6.ts"],
      })

      expect(result2.shouldWarn).toBe(true)
    })
  })

  describe("skip option", () => {
    //#given user wants to skip check
    //#when checking with skip flag
    //#then should not warn
    it("should allow skipping check", () => {
      const result = checker.check({
        files: ["f1.ts", "f2.ts", "f3.ts", "f4.ts", "f5.ts"],
        skipCheck: true,
      })

      expect(result.shouldWarn).toBe(false)
      expect(result.skipped).toBe(true)
    })
  })

  describe("warning message", () => {
    it("should suggest splitting into multiple commits", () => {
      const result = checker.check({
        files: ["f1.ts", "f2.ts", "f3.ts", "f4.ts"],
      })

      expect(result.message).toContain("分拆")
    })

    it("should include file count in message", () => {
      const result = checker.check({
        files: ["f1.ts", "f2.ts", "f3.ts", "f4.ts", "f5.ts"],
      })

      expect(result.message).toContain("5")
    })
  })

  describe("git command detection", () => {
    it("should detect git commit command", () => {
      const isCommit = checker.isCommitCommand("git commit -m 'test'")
      expect(isCommit).toBe(true)
    })

    it("should detect git commit with flags", () => {
      const isCommit = checker.isCommitCommand("git commit -am 'test'")
      expect(isCommit).toBe(true)
    })

    it("should not match git add", () => {
      const isCommit = checker.isCommitCommand("git add .")
      expect(isCommit).toBe(false)
    })

    it("should not match git status", () => {
      const isCommit = checker.isCommitCommand("git status")
      expect(isCommit).toBe(false)
    })
  })
})

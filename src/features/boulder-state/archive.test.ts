import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { archivePlan, findCompletedPlans } from "./storage"
import { PROMETHEUS_PLANS_DIR, COMPLETED_PLANS_DIR, NOTEPAD_BASE_PATH, COMPLETED_NOTEPAD_DIR } from "./constants"

describe("archive functions", () => {
  const TEST_DIR = join(tmpdir(), "archive-test-" + Date.now())

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  describe("archivePlan", () => {
    test("moves plan to completed dir", () => {
      const planName = "test-plan"
      const planDir = join(TEST_DIR, PROMETHEUS_PLANS_DIR)
      if (!existsSync(planDir)) mkdirSync(planDir, { recursive: true })
      const sourcePlan = join(planDir, `${planName}.md`)
      writeFileSync(sourcePlan, "# Test Plan\n- [x] Task 1")

      const result = archivePlan(TEST_DIR, planName)

      const archivedPath = join(TEST_DIR, COMPLETED_PLANS_DIR, `${planName}.md`)
      expect(result.success).toBe(true)
      expect(existsSync(archivedPath)).toBe(true)
      expect(existsSync(sourcePlan)).toBe(false)
    })

    test("renames on conflict with -2 suffix", () => {
      const planName = "conflict-plan"
      const planDir = join(TEST_DIR, PROMETHEUS_PLANS_DIR)
      if (!existsSync(planDir)) mkdirSync(planDir, { recursive: true })
      const sourcePlan = join(planDir, `${planName}.md`)
      writeFileSync(sourcePlan, "# Plan")
      
      const completedDir = join(TEST_DIR, COMPLETED_PLANS_DIR)
      if (!existsSync(completedDir)) mkdirSync(completedDir, { recursive: true })
      writeFileSync(join(completedDir, `${planName}.md`), "existing")

      const result = archivePlan(TEST_DIR, planName)

      const archivedPath = join(TEST_DIR, COMPLETED_PLANS_DIR, `${planName}-2.md`)
      expect(result.success).toBe(true)
      expect(existsSync(archivedPath)).toBe(true)
    })

    test("moves notepad if exists", () => {
      const planName = "with-notepad"
      const planDir = join(TEST_DIR, PROMETHEUS_PLANS_DIR)
      if (!existsSync(planDir)) mkdirSync(planDir, { recursive: true })
      writeFileSync(join(planDir, `${planName}.md`), "# Plan")
      
      const notepadDir = join(TEST_DIR, NOTEPAD_BASE_PATH)
      if (!existsSync(notepadDir)) mkdirSync(notepadDir, { recursive: true })
      writeFileSync(join(notepadDir, `${planName}.md`), "notes")

      const result = archivePlan(TEST_DIR, planName)

      const archivedNotepad = join(TEST_DIR, COMPLETED_NOTEPAD_DIR, `${planName}.md`)
      expect(result.success).toBe(true)
      expect(existsSync(archivedNotepad)).toBe(true)
    })

    test("fails for non-existent plan", () => {
      const result = archivePlan(TEST_DIR, "non-existent")
      expect(result.success).toBe(false)
      expect(result.error).toContain("not found")
    })
  })

  describe("findCompletedPlans", () => {
    test("returns empty array when no completed plans", () => {
      const result = findCompletedPlans(TEST_DIR)
      expect(result).toEqual([])
    })

    test("returns list of completed plans", () => {
      const completedDir = join(TEST_DIR, COMPLETED_PLANS_DIR)
      if (!existsSync(completedDir)) mkdirSync(completedDir, { recursive: true })
      writeFileSync(join(completedDir, "plan-a.md"), "# A")
      writeFileSync(join(completedDir, "plan-b.md"), "# B")

      const result = findCompletedPlans(TEST_DIR)
      expect(result.length).toBe(2)
    })
  })
})

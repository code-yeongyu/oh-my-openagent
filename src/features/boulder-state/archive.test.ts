import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { archiveCompletedPlan } from "./archive"
import { readBoulderState, writeBoulderState, clearBoulderState } from "./storage"
import type { BoulderState } from "./types"
import type { SisyphusAgentConfig } from "../../config/schema"

describe("archive", () => {
  const TEST_DIR = join(tmpdir(), "archive-test-" + Date.now())
  const SISYPHUS_DIR = join(TEST_DIR, ".sisyphus")
  const PLANS_DIR = join(SISYPHUS_DIR, "plans")
  const ARCHIVE_DIR = join(SISYPHUS_DIR, "archive")

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
    if (!existsSync(SISYPHUS_DIR)) {
      mkdirSync(SISYPHUS_DIR, { recursive: true })
    }
    if (!existsSync(PLANS_DIR)) {
      mkdirSync(PLANS_DIR, { recursive: true })
    }
    clearBoulderState(TEST_DIR)
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe("archiveCompletedPlan", () => {
    test("should create archive file in archive directory", () => {
      // #given - completed plan with boulder state
      const planPath = join(PLANS_DIR, "test-plan.md")
      writeFileSync(planPath, `# Test Plan
- [x] Task 1
- [x] Task 2
`)
      const boulderState: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-01T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, boulderState)
      const config: SisyphusAgentConfig = { archive_completed_plans: true }

      // #when
      const result = archiveCompletedPlan(TEST_DIR, boulderState, config)

      // #then
      expect(result).toBe(true)
      expect(existsSync(ARCHIVE_DIR)).toBe(true)
      const archiveFiles = require("node:fs").readdirSync(ARCHIVE_DIR)
      expect(archiveFiles.length).toBeGreaterThan(0)
    })

    test("should include YAML frontmatter with required metadata fields", () => {
      // #given - completed plan with boulder state
      const planPath = join(PLANS_DIR, "metadata-plan.md")
      writeFileSync(planPath, `# Metadata Plan
- [x] Task 1
`)
      const boulderState: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-01T10:00:00Z",
        session_ids: ["session-1", "session-2"],
        plan_name: "metadata-plan",
      }
      writeBoulderState(TEST_DIR, boulderState)
      const config: SisyphusAgentConfig = { archive_completed_plans: true }

      // #when
      archiveCompletedPlan(TEST_DIR, boulderState, config)

      // #then
      const archiveFiles = require("node:fs").readdirSync(ARCHIVE_DIR)
      const archivePath = join(ARCHIVE_DIR, archiveFiles[0])
      const content = readFileSync(archivePath, "utf-8")
      
      expect(content).toContain("completed_at:")
      expect(content).toContain("session_count:")
      expect(content).toContain("total_tasks:")
      expect(content).toContain("duration_hours:")
    })

    test("should preserve original plan content after frontmatter", () => {
      // #given - completed plan with specific content
      const originalContent = `# Original Plan
- [x] Task 1
- [x] Task 2

## Details
Some important details here.
`
      const planPath = join(PLANS_DIR, "content-plan.md")
      writeFileSync(planPath, originalContent)
      const boulderState: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-01T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "content-plan",
      }
      writeBoulderState(TEST_DIR, boulderState)
      const config: SisyphusAgentConfig = { archive_completed_plans: true }

      // #when
      archiveCompletedPlan(TEST_DIR, boulderState, config)

      // #then
      const archiveFiles = require("node:fs").readdirSync(ARCHIVE_DIR)
      const archivePath = join(ARCHIVE_DIR, archiveFiles[0])
      const content = readFileSync(archivePath, "utf-8")
      
      expect(content).toContain("# Original Plan")
      expect(content).toContain("- [x] Task 1")
      expect(content).toContain("## Details")
      expect(content).toContain("Some important details here.")
    })

    test("should clear boulder state only after successful archive", () => {
      // #given - completed plan with boulder state
      const planPath = join(PLANS_DIR, "cleanup-plan.md")
      writeFileSync(planPath, `# Cleanup Plan
- [x] Task 1
`)
      const boulderState: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-01T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "cleanup-plan",
      }
      writeBoulderState(TEST_DIR, boulderState)
      const config: SisyphusAgentConfig = { archive_completed_plans: true }

      // #when
      const result = archiveCompletedPlan(TEST_DIR, boulderState, config)

      // #then
      expect(result).toBe(true)
      const boulderPath = join(SISYPHUS_DIR, "boulder.json")
      expect(existsSync(boulderPath)).toBe(false)
    })

    test("should handle filename collision with timestamp suffix", () => {
      // #given - two plans with same name archived
      const planPath = join(PLANS_DIR, "collision-plan.md")
      writeFileSync(planPath, `# Collision Plan
- [x] Task 1
`)
      const boulderState: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-01T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "collision-plan",
      }
      writeBoulderState(TEST_DIR, boulderState)
      const config: SisyphusAgentConfig = { archive_completed_plans: true }

      // Create first archive
      archiveCompletedPlan(TEST_DIR, boulderState, config)
      const firstArchiveFiles = require("node:fs").readdirSync(ARCHIVE_DIR)
      expect(firstArchiveFiles.length).toBe(1)

      // Recreate boulder state for second archive
      writeBoulderState(TEST_DIR, boulderState)

      // #when - archive again
      archiveCompletedPlan(TEST_DIR, boulderState, config)

      // #then - should have different filename or handle collision
      const secondArchiveFiles = require("node:fs").readdirSync(ARCHIVE_DIR)
      expect(secondArchiveFiles.length).toBeGreaterThanOrEqual(1)
    })

    test("should skip archiving when config disables it", () => {
      // #given - completed plan with archiving disabled
      const planPath = join(PLANS_DIR, "disabled-plan.md")
      writeFileSync(planPath, `# Disabled Plan
- [x] Task 1
`)
      const boulderState: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-01T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "disabled-plan",
      }
      writeBoulderState(TEST_DIR, boulderState)
      const config: SisyphusAgentConfig = { archive_completed_plans: false }

      // #when
      const result = archiveCompletedPlan(TEST_DIR, boulderState, config)

      // #then
      expect(result).toBe(false)
      expect(existsSync(ARCHIVE_DIR)).toBe(false)
      // Boulder state should still exist
      expect(readBoulderState(TEST_DIR)).not.toBeNull()
    })

    test("should skip archiving if plan has zero checkboxes (draft protection)", () => {
      // #given - draft plan with no checkboxes
      const planPath = join(PLANS_DIR, "draft-plan.md")
      writeFileSync(planPath, `# Draft Plan
No tasks yet
`)
      const boulderState: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-01T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "draft-plan",
      }
      writeBoulderState(TEST_DIR, boulderState)
      const config: SisyphusAgentConfig = { archive_completed_plans: true }

      // #when
      const result = archiveCompletedPlan(TEST_DIR, boulderState, config)

      // #then
      expect(result).toBe(false)
      expect(existsSync(ARCHIVE_DIR)).toBe(false)
      // Boulder state should still exist
      expect(readBoulderState(TEST_DIR)).not.toBeNull()
    })

    test("should skip if archive already exists (idempotency)", () => {
      // #given - completed plan already archived
      const planPath = join(PLANS_DIR, "idempotent-plan.md")
      writeFileSync(planPath, `# Idempotent Plan
- [x] Task 1
`)
      const boulderState: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-01T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "idempotent-plan",
      }
      writeBoulderState(TEST_DIR, boulderState)
      const config: SisyphusAgentConfig = { archive_completed_plans: true }

      // First archive
      archiveCompletedPlan(TEST_DIR, boulderState, config)
      const firstArchiveFiles = require("node:fs").readdirSync(ARCHIVE_DIR)

      // Recreate boulder state
      writeBoulderState(TEST_DIR, boulderState)

      // #when - try to archive again
      const result = archiveCompletedPlan(TEST_DIR, boulderState, config)

      // #then - should return true (already done) but not create duplicate
      expect(result).toBe(true)
      const secondArchiveFiles = require("node:fs").readdirSync(ARCHIVE_DIR)
      expect(secondArchiveFiles.length).toBe(firstArchiveFiles.length)
    })
  })
})

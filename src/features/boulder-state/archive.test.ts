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
      // #given - first plan archived, then second plan with same name
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
      expect(firstArchiveFiles[0]).toBe("collision-plan.md")

      // Modify plan content and recreate boulder state (simulates new completion)
      writeFileSync(planPath, `# Collision Plan
- [x] Task 1
- [x] Task 2
`)
      const boulderState2: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-01T11:00:00Z",
        session_ids: ["session-2"],
        plan_name: "collision-plan",
      }
      writeBoulderState(TEST_DIR, boulderState2)

      // #when - archive again with same plan name
      archiveCompletedPlan(TEST_DIR, boulderState2, config)

      // #then - should have TWO files: original + timestamped
      const secondArchiveFiles = require("node:fs").readdirSync(ARCHIVE_DIR)
      expect(secondArchiveFiles.length).toBe(2)
      expect(secondArchiveFiles).toContain("collision-plan.md")
      // Second file should have timestamp suffix (format: collision-plan-YYYY-MM-DDTHH-MM-SS-sssZ.md)
      const timestampedFile = secondArchiveFiles.find((f: string) => f !== "collision-plan.md")
      expect(timestampedFile).toBeDefined()
      expect(timestampedFile).toMatch(/^collision-plan-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.md$/)
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

     test("should return false for incomplete plan (defense-in-depth)", () => {
       // #given - plan with incomplete tasks (3/5 done)
       const planPath = join(PLANS_DIR, "incomplete-plan.md")
       writeFileSync(planPath, `# Incomplete Plan
- [x] Task 1
- [x] Task 2
- [x] Task 3
- [ ] Task 4
- [ ] Task 5
`)
       const boulderState: BoulderState = {
         active_plan: planPath,
         started_at: "2026-01-01T10:00:00Z",
         session_ids: ["session-1"],
         plan_name: "incomplete-plan",
       }
       writeBoulderState(TEST_DIR, boulderState)
       const config: SisyphusAgentConfig = { archive_completed_plans: true }

       // #when
       const result = archiveCompletedPlan(TEST_DIR, boulderState, config)

       // #then - should NOT archive incomplete plan
       expect(result).toBe(false)
       expect(existsSync(ARCHIVE_DIR)).toBe(false)
       // Boulder state should be preserved
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

       test("should return false when plan file cannot be read (TOCTOU)", () => {
         // #given
         const planPath = join(PLANS_DIR, "toctou-plan.md")
         writeFileSync(planPath, "# Plan\n- [x] Task 1\n- [x] Task 2")
         const boulderState: BoulderState = {
           active_plan: planPath,
           started_at: "2026-01-01T10:00:00Z",
           session_ids: ["session-1"],
           plan_name: "toctou-plan",
         }
         writeBoulderState(TEST_DIR, boulderState)
         const config: SisyphusAgentConfig = { archive_completed_plans: true }

         rmSync(planPath)

         // #when
         const result = archiveCompletedPlan(TEST_DIR, boulderState, config)

         // #then
         expect(result).toBe(false)
         expect(readBoulderState(TEST_DIR)).not.toBeNull()
       })

       test("should return false when sub-second collision occurs", () => {
         // #given - create situation where timestamped file already exists
         const planPath = join(PLANS_DIR, "subsecond-plan.md")
         writeFileSync(planPath, "# Plan\n- [x] Task 1")
         
         // Pre-create the archive directory
         if (!existsSync(ARCHIVE_DIR)) {
           mkdirSync(ARCHIVE_DIR, { recursive: true })
         }
         
         // First, create the base archive file (simulates first completion)
         writeFileSync(join(ARCHIVE_DIR, "subsecond-plan.md"), "---\ncompleted_at: old\n---\n# Plan\n- [x] Task 1")
         
         const boulderState: BoulderState = {
           active_plan: planPath,
           started_at: "2026-01-01T10:00:00Z",
           session_ids: ["session-1"],
           plan_name: "subsecond-plan",
         }
         writeBoulderState(TEST_DIR, boulderState)
         const config: SisyphusAgentConfig = { archive_completed_plans: true }

         // Mock Date to force same timestamp
         const originalDate = Date
         const fixedTime = new Date("2026-01-29T10:00:00.000Z")
         global.Date = class extends originalDate {
           constructor() { super(); return fixedTime }
           static now() { return fixedTime.getTime() }
         } as any
         
         // Pre-create the timestamped file (simulates sub-second collision)
         const timestamp = fixedTime.toISOString().replace(/[:.]/g, "-")
         writeFileSync(join(ARCHIVE_DIR, `subsecond-plan-${timestamp}.md`), "collision content")

         // #when
         const result = archiveCompletedPlan(TEST_DIR, boulderState, config)
         
         // Restore Date
         global.Date = originalDate

         // #then - should return false (fail explicitly, don't lose data)
         expect(result).toBe(false)
         // Boulder state should be preserved (don't clear on failure)
         expect(readBoulderState(TEST_DIR)).not.toBeNull()
       })
    })
})

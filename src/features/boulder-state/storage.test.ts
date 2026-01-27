import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  readBoulderState,
  writeBoulderState,
  appendSessionId,
  clearBoulderState,
  getPlanProgress,
  getPlanName,
  createBoulderState,
  findPrometheusPlans,
} from "./storage"
import type { BoulderState } from "./types"

describe("boulder-state", () => {
  const TEST_DIR = join(tmpdir(), "boulder-state-test-" + Date.now())
  const SISYPHUS_DIR = join(TEST_DIR, ".sisyphus")

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
    if (!existsSync(SISYPHUS_DIR)) {
      mkdirSync(SISYPHUS_DIR, { recursive: true })
    }
    clearBoulderState(TEST_DIR)
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe("readBoulderState", () => {
    test("should return null when no boulder.json exists", () => {
      // #given - no boulder.json file
      // #when
      const result = readBoulderState(TEST_DIR)
      // #then
      expect(result).toBeNull()
    })

    test("should read valid boulder state", () => {
      // #given - valid boulder.json
      const state: BoulderState = {
        active_plan: "/path/to/plan.md",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1", "session-2"],
        plan_name: "my-plan",
      }
      writeBoulderState(TEST_DIR, state)

      // #when
      const result = readBoulderState(TEST_DIR)

      // #then
      expect(result).not.toBeNull()
      expect(result?.active_plan).toBe("/path/to/plan.md")
      expect(result?.session_ids).toEqual(["session-1", "session-2"])
      expect(result?.plan_name).toBe("my-plan")
    })
  })

  describe("writeBoulderState", () => {
    test("should write state and create .sisyphus directory if needed", () => {
      // #given - state to write
      const state: BoulderState = {
        active_plan: "/test/plan.md",
        started_at: "2026-01-02T12:00:00Z",
        session_ids: ["ses-123"],
        plan_name: "test-plan",
      }

      // #when
      const success = writeBoulderState(TEST_DIR, state)
      const readBack = readBoulderState(TEST_DIR)

      // #then
      expect(success).toBe(true)
      expect(readBack).not.toBeNull()
      expect(readBack?.active_plan).toBe("/test/plan.md")
    })
  })

  describe("appendSessionId", () => {
    test("should append new session id to existing state", () => {
      // #given - existing state with one session
      const state: BoulderState = {
        active_plan: "/plan.md",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan",
      }
      writeBoulderState(TEST_DIR, state)

      // #when
      const result = appendSessionId(TEST_DIR, "session-2")

      // #then
      expect(result).not.toBeNull()
      expect(result?.session_ids).toEqual(["session-1", "session-2"])
    })

    test("should not duplicate existing session id", () => {
      // #given - state with session-1 already
      const state: BoulderState = {
        active_plan: "/plan.md",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan",
      }
      writeBoulderState(TEST_DIR, state)

      // #when
      appendSessionId(TEST_DIR, "session-1")
      const result = readBoulderState(TEST_DIR)

      // #then
      expect(result?.session_ids).toEqual(["session-1"])
    })

    test("should return null when no state exists", () => {
      // #given - no boulder.json
      // #when
      const result = appendSessionId(TEST_DIR, "new-session")
      // #then
      expect(result).toBeNull()
    })
  })

  describe("clearBoulderState", () => {
    test("should remove boulder.json", () => {
      // #given - existing state
      const state: BoulderState = {
        active_plan: "/plan.md",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "plan",
      }
      writeBoulderState(TEST_DIR, state)

      // #when
      const success = clearBoulderState(TEST_DIR)
      const result = readBoulderState(TEST_DIR)

      // #then
      expect(success).toBe(true)
      expect(result).toBeNull()
    })

    test("should succeed even when no file exists", () => {
      // #given - no boulder.json
      // #when
      const success = clearBoulderState(TEST_DIR)
      // #then
      expect(success).toBe(true)
    })
  })

  describe("getPlanProgress", () => {
    test("should count completed and uncompleted checkboxes", () => {
      // #given - plan file with checkboxes
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, `# Plan
- [ ] Task 1
- [x] Task 2  
- [ ] Task 3
- [X] Task 4
`)

      // #when
      const progress = getPlanProgress(planPath)

      // #then
      expect(progress.total).toBe(4)
      expect(progress.completed).toBe(2)
      expect(progress.isComplete).toBe(false)
    })

    test("should return isComplete true when all checked", () => {
      // #given - all tasks completed
      const planPath = join(TEST_DIR, "complete-plan.md")
      writeFileSync(planPath, `# Plan
- [x] Task 1
- [X] Task 2
`)

      // #when
      const progress = getPlanProgress(planPath)

      // #then
      expect(progress.total).toBe(2)
      expect(progress.completed).toBe(2)
      expect(progress.isComplete).toBe(true)
    })

    test("should return isComplete true for empty plan", () => {
      // #given - plan with no checkboxes
      const planPath = join(TEST_DIR, "empty-plan.md")
      writeFileSync(planPath, "# Plan\nNo tasks here")

      // #when
      const progress = getPlanProgress(planPath)

      // #then
      expect(progress.total).toBe(0)
      expect(progress.isComplete).toBe(true)
    })

    test("should handle non-existent file", () => {
      // #given - non-existent file
      // #when
      const progress = getPlanProgress("/non/existent/file.md")
      // #then
      expect(progress.total).toBe(0)
      expect(progress.isComplete).toBe(true)
})
  })

  describe("getPlanProgress - phase parsing", () => {
    test("should parse backtick syntax phases", () => {
      // #given - plan with backtick status
      const planPath = join(TEST_DIR, "backtick-plan.md")
      writeFileSync(planPath, `# Plan
## Phase 1: Setup \`complete\`
- [x] Task 1

## Phase 2: Implementation \`in_progress\`
- [ ] Task 2
`)
      // #when
      const progress = getPlanProgress(planPath)
      // #then
      expect(progress.phases).toBeDefined()
      expect(progress.phases?.length).toBe(2)
      expect(progress.phases?.[0].name).toBe("Phase 1: Setup")
      expect(progress.phases?.[0].status).toBe("complete")
      expect(progress.phases?.[1].name).toBe("Phase 2: Implementation")
      expect(progress.phases?.[1].status).toBe("in_progress")
    })

    test("should parse Status line syntax", () => {
      // #given - plan with Status line
      const planPath = join(TEST_DIR, "status-line-plan.md")
      writeFileSync(planPath, `# Plan
## Phase 1: Setup
- **Status:** complete
- [x] Task 1

## Phase 2: Implementation
- **Status:** in_progress
- [ ] Task 2
`)
      // #when
      const progress = getPlanProgress(planPath)
      // #then
      expect(progress.phases?.length).toBe(2)
      expect(progress.phases?.[0].status).toBe("complete")
      expect(progress.phases?.[1].status).toBe("in_progress")
    })

    test("should prioritize backtick over Status line", () => {
      // #given - plan with both syntaxes (backtick wins)
      const planPath = join(TEST_DIR, "mixed-syntax-plan.md")
      writeFileSync(planPath, `# Plan
## Phase 1: Setup \`complete\`
- **Status:** pending
- [x] Task 1
`)
      // #when
      const progress = getPlanProgress(planPath)
      // #then
      expect(progress.phases?.[0].status).toBe("complete") // backtick wins
    })

    test("should default to pending when no status", () => {
      // #given - plan with no status
      const planPath = join(TEST_DIR, "no-status-plan.md")
      writeFileSync(planPath, `# Plan
## Phase 1: Setup
- [ ] Task 1
`)
      // #when
      const progress = getPlanProgress(planPath)
      // #then
      expect(progress.phases?.[0].status).toBe("pending")
    })

    test("should be case insensitive", () => {
      // #given - plan with mixed case
      const planPath = join(TEST_DIR, "case-insensitive-plan.md")
      writeFileSync(planPath, `# Plan
## Phase 1: Setup \`COMPLETE\`
## Phase 2: Work \`In_Progress\`
## Phase 3: Review \`PENDING\`
`)
      // #when
      const progress = getPlanProgress(planPath)
      // #then
      expect(progress.phases?.[0].status).toBe("complete")
      expect(progress.phases?.[1].status).toBe("in_progress")
      expect(progress.phases?.[2].status).toBe("pending")
    })

    test("should calculate phase boundaries correctly", () => {
      // #given - plan with multiple phases
      const planPath = join(TEST_DIR, "boundaries-plan.md")
      writeFileSync(planPath, `# Plan
## Phase 1: Setup \`complete\`
- [x] Task 1
- [x] Task 2

## Phase 2: Implementation \`pending\`
- [ ] Task 3

---
## Notes
Some notes here
`)
      // #when
      const progress = getPlanProgress(planPath)
      // #then
      expect(progress.phases?.length).toBe(2)
      expect(progress.phases?.[0].line).toBe(2) // Line number of Phase 1 header
      expect(progress.phases?.[1].line).toBe(6) // Line number of Phase 2 header
    })

    test("should combine checkboxes and phases for isComplete", () => {
      // #given - all checkboxes done but phase not marked complete
      const planPath = join(TEST_DIR, "combined-check-plan.md")
      writeFileSync(planPath, `# Plan
## Phase 1: Setup \`complete\`
- [x] Task 1

## Phase 2: Implementation \`in_progress\`
- [x] Task 2
- [x] Task 3
`)
      // #when
      const progress = getPlanProgress(planPath)
      // #then
      // All checkboxes complete, but Phase 2 is in_progress, so NOT complete
      expect(progress.completed).toBe(3)
      expect(progress.total).toBe(3)
      expect(progress.isComplete).toBe(false) // Phase 2 is not complete
    })
  })

  describe("getPlanName", () => {
    test("should extract plan name from path", () => {
      // #given
      const path = "/home/user/changes/project/my-feature.md"
      // #when
      const name = getPlanName(path)
      // #then
      expect(name).toBe("my-feature")
    })
  })

  describe("createBoulderState", () => {
    test("should create state with correct fields", () => {
      // #given
      const planPath = "/path/to/auth-refactor.md"
      const sessionId = "ses-abc123"

      // #when
      const state = createBoulderState(planPath, sessionId)

      // #then
      expect(state.active_plan).toBe(planPath)
      expect(state.session_ids).toEqual([sessionId])
      expect(state.plan_name).toBe("auth-refactor")
      expect(state.started_at).toBeDefined()
    })
  })
})

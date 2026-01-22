import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { readPlanProgress } from "./reader"
import { writeBoulderState } from "../boulder-state/storage"
import type { BoulderState } from "../boulder-state/types"

describe("plan-progress-reader", () => {
  const TEST_DIR = join(tmpdir(), "plan-progress-reader-test-" + Date.now())
  const SISYPHUS_DIR = join(TEST_DIR, ".sisyphus")

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
    if (!existsSync(SISYPHUS_DIR)) {
      mkdirSync(SISYPHUS_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  test("should return null when boulder.json does not exist", () => {
    // #given - no boulder.json
    // #when
    const result = readPlanProgress(TEST_DIR)
    // #then
    expect(result).toBeNull()
  })

  test("should return null when plan file does not exist", () => {
    // #given - boulder.json with non-existent plan
    const state: BoulderState = {
      active_plan: join(TEST_DIR, "non-existent.md"),
      started_at: "2026-01-21T10:00:00Z",
      session_ids: ["session-1"],
      plan_name: "non-existent",
    }
    writeBoulderState(TEST_DIR, state)

    // #when
    const result = readPlanProgress(TEST_DIR)

    // #then
    expect(result).toBeNull()
  })

  test("should parse checkboxes with correct status and priority", () => {
    // #given - plan with various checkboxes
    const planPath = join(TEST_DIR, "test-plan.md")
    writeFileSync(planPath, `# Plan

## Phase 1: Setup \`complete\`

- [x] Task 1 completed
- [ ] Task 2 pending
- [~] Task 3 in progress
- [-] Task 4 cancelled

### Task 1.1: Sub-task
- [ ] Sub-task item (medium priority)

**Acceptance Criteria:**
- [ ] AC item 1 (low priority)
- [x] AC item 2 (low priority)
`)

    const state: BoulderState = {
      active_plan: planPath,
      started_at: "2026-01-21T10:00:00Z",
      session_ids: ["session-1"],
      plan_name: "test-plan",
    }
    writeBoulderState(TEST_DIR, state)

    // #when
    const result = readPlanProgress(TEST_DIR)

    // #then
    expect(result).not.toBeNull()
    expect(result?.planPath).toBe(planPath)
    expect(result?.checkboxes.length).toBe(7)
    
    // Check statuses
    expect(result?.checkboxes[0].status).toBe("completed")
    expect(result?.checkboxes[1].status).toBe("pending")
    expect(result?.checkboxes[2].status).toBe("in_progress")
    expect(result?.checkboxes[3].status).toBe("cancelled")
    
    // Check priorities
    expect(result?.checkboxes[0].priority).toBe("high") // Top-level
    expect(result?.checkboxes[4].priority).toBe("high") // Sub-task header level (not indented)
    expect(result?.checkboxes[5].priority).toBe("low") // Under Acceptance Criteria
  })

  test("should include phase information from getPlanProgress", () => {
    // #given - plan with phases
    const planPath = join(TEST_DIR, "phase-plan.md")
    writeFileSync(planPath, `# Plan

## Phase 1: Setup \`complete\`
- [x] Task 1

## Phase 2: Implementation \`in_progress\`
- [ ] Task 2
`)

    const state: BoulderState = {
      active_plan: planPath,
      started_at: "2026-01-21T10:00:00Z",
      session_ids: ["session-1"],
      plan_name: "phase-plan",
    }
    writeBoulderState(TEST_DIR, state)

    // #when
    const result = readPlanProgress(TEST_DIR)

    // #then
    expect(result).not.toBeNull()
    expect(result?.phases?.length).toBe(2)
    expect(result?.phases?.[0].status).toBe("complete")
    expect(result?.phases?.[1].status).toBe("in_progress")
    expect(result?.isComplete).toBe(false) // Phase 2 not complete
  })
})

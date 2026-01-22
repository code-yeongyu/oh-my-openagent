import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { reorganizePlan } from "./reorganize"

describe("plan-reorganizer", () => {
  const TEST_DIR = join(tmpdir(), "plan-reorganizer-test-" + Date.now())

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  test("should identify phase boundaries correctly", () => {
    // #given - plan with multiple phases
    const planPath = join(TEST_DIR, "boundaries.md")
    writeFileSync(planPath, `# Plan

## Phase 1: Setup \`complete\`
- [x] Task 1

## Phase 2: Implementation \`pending\`
- [ ] Task 2

---

## Notes
Some notes
`)
    // #when
    const result = reorganizePlan(planPath)
    
    // #then - Phase 1 should be moved, Phase 2 stays
    const content = readFileSync(planPath, "utf-8")
    expect(result).toBe(true)
    expect(content).toContain("## Phase 2: Implementation")
    expect(content).toContain("## Completed Phases")
    expect(content).toContain("### Phase 1: Setup")
  })

  test("should detect completed phases with all [x] checkboxes", () => {
    // #given - phase with all completed checkboxes
    const planPath = join(TEST_DIR, "completed.md")
    writeFileSync(planPath, `# Plan

## Phase 1: Setup \`complete\`
- [x] Task 1
- [x] Task 2
- [-] Task 3 (cancelled)

## Phase 2: Work \`pending\`
- [x] Task 4
- [ ] Task 5
`)
    // #when
    const result = reorganizePlan(planPath)
    
    // #then
    const content = readFileSync(planPath, "utf-8")
    expect(result).toBe(true)
    // Phase 1 moved (all [x] or [-])
    expect(content).toContain("### Phase 1: Setup")
    // Phase 2 stays (has [ ])
    expect(content).toContain("## Phase 2: Work")
  })

  test("should move completed phases to Completed Phases section", () => {
    // #given
    const planPath = join(TEST_DIR, "move.md")
    writeFileSync(planPath, `# Plan

## Phase 1: Done \`complete\`
- [x] Task 1

## Phase 2: Active \`in_progress\`
- [ ] Task 2
`)
    // #when
    reorganizePlan(planPath)
    
    // #then
    const content = readFileSync(planPath, "utf-8")
    const phase1Index = content.indexOf("Phase 1")
    const phase2Index = content.indexOf("Phase 2")
    const completedIndex = content.indexOf("Completed Phases")
    
    // Phase 2 should come before Completed Phases
    expect(phase2Index).toBeLessThan(completedIndex)
    // Phase 1 should come after Completed Phases header
    expect(phase1Index).toBeGreaterThan(completedIndex)
  })

  test("should create Completed Phases section if not exists", () => {
    // #given - no Completed Phases section
    const planPath = join(TEST_DIR, "create-section.md")
    writeFileSync(planPath, `# Plan

## Phase 1: Done \`complete\`
- [x] Task 1

---

## Legend
Some legend
`)
    // #when
    reorganizePlan(planPath)
    
    // #then
    const content = readFileSync(planPath, "utf-8")
    expect(content).toContain("## Completed Phases")
  })

  test("should downgrade ## to ### when moving to Completed Phases", () => {
    // #given
    const planPath = join(TEST_DIR, "downgrade.md")
    writeFileSync(planPath, `# Plan

## Phase 1: Done \`complete\`
- [x] Task 1

## Phase 2: Active
- [ ] Task 2
`)
    // #when
    reorganizePlan(planPath)
    
    // #then
    const content = readFileSync(planPath, "utf-8")
    // Original ## should become ###
    expect(content).toContain("### Phase 1: Done")
    // Active phase keeps ##
    expect(content).toContain("## Phase 2: Active")
  })

  test("should return false when no changes needed", () => {
    // #given - no completed phases
    const planPath = join(TEST_DIR, "no-changes.md")
    writeFileSync(planPath, `# Plan

## Phase 1: Active
- [ ] Task 1
- [ ] Task 2
`)
    // #when
    const result = reorganizePlan(planPath)
    
    // #then
    expect(result).toBe(false)
  })

  test("should return false for non-existent file", () => {
    // #given - non-existent file
    const planPath = join(TEST_DIR, "non-existent.md")
    
    // #when
    const result = reorganizePlan(planPath)
    
    // #then
    expect(result).toBe(false)
  })
})

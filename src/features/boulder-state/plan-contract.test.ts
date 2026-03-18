import { describe, expect, test } from "bun:test"
import { parsePlanContractFromContent, summarizePlanExecution } from "./plan-contract"

describe("plan-contract parser", () => {
  test("parses top-level tasks and ignores nested acceptance criteria checkboxes", () => {
    const content = `# Example Plan

## TODOs

- [ ] 1. Build service
  **Acceptance Criteria**:
  - [ ] service file exists
  - [ ] tests pass

- [x] 2. Wire route

## Final Verification Wave

- [ ] F1. Plan Compliance Audit
`

    const contract = parsePlanContractFromContent("/tmp/example-plan.md", content)

    expect(contract.planName).toBe("example-plan")
    expect(contract.tasks).toHaveLength(3)
    expect(contract.tasks.map((task) => task.id)).toEqual(["1", "2", "F1"])
    expect(contract.tasks.map((task) => task.section)).toEqual(["todo", "todo", "final-wave"])
    expect(contract.tasks[0].acceptanceCriteria).toEqual(["service file exists", "tests pass"])
  })

  test("parses delegation recommendation category, skills, and dependencies", () => {
    const content = `# Plan

## TODOs

- [ ] 1. Add login service

  **Delegation Recommendation:**
  - Category: \`deep\` - reason
  - Skills: [\`auth\`, \`api\`] - reasons

  **Depends On**: None
`

    const contract = parsePlanContractFromContent("/tmp/login-plan.md", content)
    const task = contract.tasks[0]

    expect(task.sourceFormat).toBe("delegation-recommendation")
    expect(task.category).toBe("deep")
    expect(task.skills).toEqual(["auth", "api"])
    expect(task.dependsOn).toEqual([])
  })

  test("parses plain depends-on metadata without markdown bold markers", () => {
    const content = `# Plan

## TODOs

- [ ] 3. Wire dashboard

  Depends On: [Task 1, Task 2]
`

    const contract = parsePlanContractFromContent("/tmp/plain-deps-plan.md", content)

    expect(contract.tasks[0].dependsOn).toEqual(["1", "2"])
  })

  test("parses recommended agent profile and task-local parallelization metadata", () => {
    const content = `# Plan

## TODOs

- [ ] 2. Add API route

  **Recommended Agent Profile**:
  - Category: \`unspecified-high\` — Reason: backend integration
  - Skills: [\`api\`] — needed

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [Task 4] | Blocked By: [Task 1]
`

    const contract = parsePlanContractFromContent("/tmp/api-plan.md", content)
    const task = contract.tasks[0]

    expect(task.sourceFormat).toBe("recommended-agent-profile")
    expect(task.category).toBe("unspecified-high")
    expect(task.skills).toEqual(["api"])
    expect(task.wave).toBe("Wave 2")
    expect(task.blocks).toEqual(["4"])
    expect(task.blockedBy).toEqual(["1"])
  })

  test("parses plan-level wave groupings from the parallel execution graph", () => {
    const content = `# Plan

## Parallel Execution Graph

Wave 1:
├── Task 1: foundation
└── Task 5: docs

Wave 2:
├── Task 2: API
└── Task 3: UI

## TODOs

- [ ] 1. Foundation
- [ ] 2. API
- [ ] 3. UI
- [ ] 5. Docs
`

    const contract = parsePlanContractFromContent("/tmp/waves-plan.md", content)

    expect(contract.waves).toEqual([
      { id: "Wave 1", taskIds: ["1", "5"] },
      { id: "Wave 2", taskIds: ["2", "3"] },
    ])
  })

  test("summarizes next work from parsed waves and top-level tasks", () => {
    const content = `# Plan

## Parallel Execution Graph

Wave 1:
├── Task 1: foundation
└── Task 2: api

Wave 2:
└── Task 3: review

## TODOs

- [x] 1. Foundation

  **Recommended Agent Profile**:
  - Category: \`deep\`

  **Parallelization**: Can Parallel: YES | Wave 1

- [ ] 2. API

  **Recommended Agent Profile**:
  - Category: \`unspecified-high\`

  **Parallelization**: Can Parallel: YES | Wave 1

## Final Verification Wave

- [ ] F1. Review

  **Recommended Agent Profile**:
  - Category: \`oracle\`

  **Parallelization**: Can Parallel: NO | Wave 2
`

    const contract = parsePlanContractFromContent("/tmp/summary-plan.md", content)
    const summary = summarizePlanExecution(contract)

    expect(summary.progress).toEqual({ total: 3, completed: 1, isComplete: false })
    expect(summary.pendingImplementationTaskCount).toBe(1)
    expect(summary.pendingFinalWaveTaskCount).toBe(1)
    expect(summary.nextWaveId).toBe("Wave 1")
    expect(summary.nextTasks).toEqual([
      {
        id: "2",
        title: "API",
        category: "unspecified-high",
        wave: "Wave 1",
        section: "todo",
      },
    ])
  })
})

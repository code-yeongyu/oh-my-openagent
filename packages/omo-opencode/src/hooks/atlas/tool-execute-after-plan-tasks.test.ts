import { describe, expect, test } from "bun:test"
import { parseCheckedTopLevelTaskKeys } from "./tool-execute-after-plan-tasks"

describe("tool.execute.after plan task parsing", () => {
  test("#given checked todo and final-wave top-level tasks #when parsed #then task keys preserve their sections", () => {
    // given
    const planContent = `# Plan

## TODOs
- [x] 1. Implement auth
  - [x] 2. nested evidence ignored
- [ ] 2. Add tests

## Notes
- [x] 99. ignored outside task sections

## Final Verification Wave
- [X] F1. Review behavior
- [ ] F2. Run build
  - [x] F3. nested final-wave evidence ignored
`

    // when
    const keys = parseCheckedTopLevelTaskKeys(planContent)

    // then
    expect([...keys]).toEqual(["todo:1", "final-wave:f1"])
  })
})

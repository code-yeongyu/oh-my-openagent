import { describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { readCurrentTopLevelTask } from "./top-level-task"

function writePlanFile(fileName: string, content: string): string {
  const planPath = join(tmpdir(), fileName)
  writeFileSync(planPath, content, "utf-8")
  return planPath
}

describe("readCurrentTopLevelTask", () => {
  test("returns first unchecked top-level task in TODOs", () => {
    // given
    const planPath = writePlanFile(
      `top-level-task-happy-${Date.now()}.md`,
      `# Plan

## TODOs
- [x] 1. Done task
- [ ] 2. Current task

## Final Verification Wave
- [ ] F1. Final review
`,
    )

    // when
    const result = readCurrentTopLevelTask(planPath)

    // then
    expect(result).toEqual({
      key: "todo:2",
      section: "todo",
      label: "2",
      title: "Current task",
    })
  })

  test("returns null when all tasks are checked", () => {
    // given
    const planPath = writePlanFile(
      `top-level-task-all-checked-${Date.now()}.md`,
      `# Plan

## TODOs
- [x] 1. Done task
- [x] 2. Another done task

## Final Verification Wave
- [x] F1. Final done review
`,
    )

    // when
    const result = readCurrentTopLevelTask(planPath)

    // then
    expect(result).toBeNull()
  })

  test("returns null for empty plan file", () => {
    // given
    const planPath = writePlanFile(`top-level-task-empty-${Date.now()}.md`, "")

    // when
    const result = readCurrentTopLevelTask(planPath)

    // then
    expect(result).toBeNull()
  })

  test("returns null when plan file does not exist", () => {
    // given
    const planPath = join(tmpdir(), `top-level-task-missing-${Date.now()}.md`)

    // when
    const result = readCurrentTopLevelTask(planPath)

    // then
    expect(result).toBeNull()
  })

  test("skips nested or indented checkboxes", () => {
    // given
    const planPath = writePlanFile(
      `top-level-task-nested-${Date.now()}.md`,
      `# Plan

## TODOs
- [x] 1. Done task
  - [ ] nested should be ignored
- [ ] 2. Top-level pending
`,
    )

    // when
    const result = readCurrentTopLevelTask(planPath)

    // then
    expect(result?.key).toBe("todo:2")
  })

  test("falls back to Final Verification Wave when TODOs are all checked", () => {
    // given
    const planPath = writePlanFile(
      `top-level-task-fallback-${Date.now()}.md`,
      `# Plan

## TODOs
- [x] 1. Done task
- [x] 2. Done task

## Final Verification Wave
- [ ] F1. Final review pending
`,
    )

    // when
    const result = readCurrentTopLevelTask(planPath)

    // then
    expect(result).toEqual({
      key: "final-wave:f1",
      section: "final-wave",
      label: "F1",
      title: "Final review pending",
    })
  })

  test("selects the first unchecked task among mixed checked and unchecked TODOs", () => {
    // given
    const planPath = writePlanFile(
      `top-level-task-mixed-${Date.now()}.md`,
      `# Plan

## TODOs
- [x] 1. Done task
- [ ] 2. First unchecked
- [ ] 3. Second unchecked
`,
    )

    // when
    const result = readCurrentTopLevelTask(planPath)

    // then
    expect(result?.key).toBe("todo:2")
    expect(result?.title).toBe("First unchecked")
  })

  test("ignores malformed labels and continues to next unchecked task", () => {
    // given
    const planPath = writePlanFile(
      `top-level-task-malformed-${Date.now()}.md`,
      `# Plan

## TODOs
- [ ] no number prefix
- [ ] 2. Valid task after malformed label
`,
    )

    // when
    const result = readCurrentTopLevelTask(planPath)

    // then
    expect(result).toEqual({
      key: "todo:2",
      section: "todo",
      label: "2",
      title: "Valid task after malformed label",
    })
  })

  test("supports unchecked tasks with asterisk bullets", () => {
    // given
    const planPath = writePlanFile(
      `top-level-task-asterisk-${Date.now()}.md`,
      `# Plan

## TODOs
* [ ] 1. Task using asterisk bullet
`,
    )

    // when
    const result = readCurrentTopLevelTask(planPath)

    // then
    expect(result?.key).toBe("todo:1")
    expect(result?.title).toBe("Task using asterisk bullet")
  })

  test("returns final-wave task when plan has only Final Verification Wave section", () => {
    // given
    const planPath = writePlanFile(
      `top-level-task-final-only-${Date.now()}.md`,
      `# Plan

## Final Verification Wave
- [ ] F2. Final-only task
`,
    )

    // when
    const result = readCurrentTopLevelTask(planPath)

    // then
    expect(result).toEqual({
      key: "final-wave:f2",
      section: "final-wave",
      label: "F2",
      title: "Final-only task",
    })
  })

  test("returns the first unchecked task when multiple unchecked tasks exist", () => {
    // given
    const planPath = writePlanFile(
      `top-level-task-multiple-${Date.now()}.md`,
      `# Plan

## TODOs
- [ ] 1. First unchecked task
- [ ] 2. Second unchecked task
- [ ] 3. Third unchecked task
`,
    )

    // when
    const result = readCurrentTopLevelTask(planPath)

    // then
    expect(result?.label).toBe("1")
    expect(result?.title).toBe("First unchecked task")
  })

  test("ignores unchecked content in non-target sections during section transitions", () => {
    // given
    const planPath = writePlanFile(
      `top-level-task-sections-${Date.now()}.md`,
      `# Plan

## Notes
- [ ] 99. Should be ignored because section is not tracked

## TODOs
- [x] 1. Done implementation task

## Decisions
- [ ] 100. Should also be ignored

## Final Verification Wave
- [ ] F3. Final verification task
`,
    )

    // when
    const result = readCurrentTopLevelTask(planPath)

    // then
    expect(result?.key).toBe("final-wave:f3")
    expect(result?.section).toBe("final-wave")
  })
})

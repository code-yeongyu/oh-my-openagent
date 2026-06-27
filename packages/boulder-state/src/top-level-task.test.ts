/// <reference path="../../../bun-test.d.ts" />

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { readCurrentTopLevelTask } from "./top-level-task"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function writePlan(markdown: string): string {
  const directory = mkdtempSync(join(tmpdir(), "boulder-top-level-task-"))
  cleanupRoots.push(directory)
  const planPath = join(directory, "plan.md")
  writeFileSync(planPath, markdown, "utf-8")
  return planPath
}

describe("readCurrentTopLevelTask", () => {
  test("#given TODOs with nested and unnumbered unchecked boxes #when reading current task #then first numbered top-level TODO is returned", () => {
    // given
    const planPath = writePlan([
      "# Plan",
      "## TODOs",
      "- [x] 1. Completed task",
      "  - [ ] 1.1 Nested task",
      "- [ ] Missing numeric label",
      "- [ ] 2. Implement the next task",
      "## Final Verification Wave",
      "- [ ] F1. Verify later",
    ].join("\n"))

    // when
    const task = readCurrentTopLevelTask(planPath)

    // then
    expect(task).toEqual({
      key: "todo:2",
      section: "todo",
      label: "2",
      title: "Implement the next task",
    })
  })

  test("#given completed TODOs and pending final wave #when reading current task #then first final verification task is returned", () => {
    // given
    const planPath = writePlan([
      "# Plan",
      "## TODOs",
      "- [x] 1. Completed task",
      "## Final Verification Wave",
      "- [ ] F1. Run the final gate",
      "- [ ] F2. Archive evidence",
    ].join("\n"))

    // when
    const task = readCurrentTopLevelTask(planPath)

    // then
    expect(task).toEqual({
      key: "final-wave:f1",
      section: "final-wave",
      label: "F1",
      title: "Run the final gate",
    })
  })
})

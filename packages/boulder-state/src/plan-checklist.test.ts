/// <reference path="../../../bun-test.d.ts" />

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { getPlanChecklist, parsePlanChecklist } from "./plan-checklist"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe("parsePlanChecklist", () => {
  test("#given top-level checkboxes in counted sections #when parsed #then legacy continuation counts are preserved", () => {
    // given
    const markdown = [
      "# Plan",
      "- [ ] Preamble task",
      "## TODOs",
      "- [ ] First",
      "- [x] Done",
      "  - [ ] Nested",
      "## Acceptance Criteria",
      "- [ ] Ignored",
      "## Final Verification Wave",
      "- [X] Verified",
      "- [ ] Final",
    ].join("\n")

    // when
    const checklist = parsePlanChecklist(markdown)

    // then
    expect(checklist).toEqual({ completed: 2, remaining: 2, total: 4, nextTaskLabel: "First" })
  })

  test("#given no counted sections #when parsed #then all top-level checkboxes are counted", () => {
    // given
    const markdown = ["# Plan", "- [ ] First", "- [x] Done", "  - [ ] Nested"].join("\n")

    // when
    const checklist = parsePlanChecklist(markdown)

    // then
    expect(checklist).toEqual({ completed: 1, remaining: 1, total: 2, nextTaskLabel: "First" })
  })
})

describe("getPlanChecklist", () => {
  test("#given missing plan path #when checklist is read #then empty checklist is returned", () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "boulder-plan-checklist-"))
    cleanupRoots.push(directory)
    mkdirSync(directory, { recursive: true })

    // when
    const checklist = getPlanChecklist(join(directory, "missing.md"))

    // then
    expect(checklist).toEqual({ completed: 0, remaining: 0, total: 0, nextTaskLabel: null })
  })

  test("#given complete plan #when checklist is read #then no next task is returned", () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "boulder-plan-checklist-"))
    cleanupRoots.push(directory)
    const planPath = join(directory, "plan.md")
    writeFileSync(planPath, "## TODOs\n- [x] First\n- [X] Second\n")

    // when
    const checklist = getPlanChecklist(planPath)

    // then
    expect(checklist).toEqual({ completed: 2, remaining: 0, total: 2, nextTaskLabel: null })
  })
})

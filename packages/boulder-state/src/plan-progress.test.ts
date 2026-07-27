/// <reference path="../../../bun-test.d.ts" />

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { getPlanProgress } from "./storage/plan-progress"

const cleanupRoots: string[] = []

function writePlan(markdown: string): string {
  const directory = mkdtempSync(join(tmpdir(), "boulder-plan-progress-"))
  cleanupRoots.push(directory)
  const planPath = join(directory, "plan.md")
  writeFileSync(planPath, markdown, "utf-8")
  return planPath
}

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe("getPlanProgress", () => {
  test("#given a plan whose every task is user-blocked #when progress is read #then the plan reads complete instead of looping", () => {
    // given
    const planPath = writePlan(
      [
        "## Todos",
        "- [~] 1. Blocked on a decision only the user can make",
        "## Final verification wave",
        "- [~] F1. Blocked on unavailable credentials",
      ].join("\n"),
    )

    // when
    const progress = getPlanProgress(planPath)

    // then
    expect(progress).toEqual({ total: 2, completed: 2, isComplete: true })
  })

  test("#given a plan mixing completed and user-blocked tasks #when progress is read #then blocked tasks stay visible in the totals", () => {
    // given
    const planPath = writePlan(
      [
        "## Todos",
        "- [x] 1. Ship the parser",
        "- [~] 2. Blocked on a decision only the user can make",
        "## Final verification wave",
        "- [~] F1. Blocked on unavailable credentials",
      ].join("\n"),
    )

    // when
    const progress = getPlanProgress(planPath)

    // then
    expect(progress).toEqual({ total: 3, completed: 3, isComplete: true })
  })

  test("#given a plan with a user-blocked task and an actionable task #when progress is read #then the plan reads incomplete", () => {
    // given
    const planPath = writePlan(
      ["## Todos", "- [~] 1. Blocked on a user-only decision", "- [ ] 2. Still actionable"].join("\n"),
    )

    // when
    const progress = getPlanProgress(planPath)

    // then
    expect(progress).toEqual({ total: 2, completed: 1, isComplete: false })
  })

  test("#given a missing plan path #when progress is read #then progress stays unknown and incomplete", () => {
    // given
    const planPath = join(mkdtempSync(join(tmpdir(), "boulder-plan-progress-")), "missing.md")

    // when
    const progress = getPlanProgress(planPath)

    // then
    expect(progress).toEqual({ total: 0, completed: 0, isComplete: false })
  })
})

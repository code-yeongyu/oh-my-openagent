import { describe, expect, test } from "bun:test"

import { clampTaskSummary, TASK_SUMMARY_MAX_LENGTH } from "./task-summary"

describe("clampTaskSummary", () => {
  test("#given undefined #when clamped #then undefined is returned", () => {
    // given / when / then
    expect(clampTaskSummary(undefined)).toBeUndefined()
  })

  test("#given a blank summary #when clamped #then it collapses to undefined", () => {
    // given / when / then
    expect(clampTaskSummary("")).toBeUndefined()
    expect(clampTaskSummary("   \n\t ")).toBeUndefined()
  })

  test("#given a multi-line summary #when clamped #then whitespace collapses to one status row", () => {
    // given / when / then
    expect(clampTaskSummary("  Refactor auth\n  into sessions   module ")).toBe("Refactor auth into sessions module")
  })

  test("#given a summary at the limit #when clamped #then it passes through unchanged", () => {
    // given
    const summary = "x".repeat(TASK_SUMMARY_MAX_LENGTH)

    // when / then
    expect(clampTaskSummary(summary)).toBe(summary)
  })

  test("#given an over-limit summary #when clamped #then the harness force-truncates to the schema limit with an ellipsis", () => {
    // given
    const clamped = clampTaskSummary("y".repeat(200))

    // then
    expect(clamped).toHaveLength(TASK_SUMMARY_MAX_LENGTH)
    expect(clamped?.endsWith("...")).toBe(true)
    expect(clamped?.startsWith("y".repeat(TASK_SUMMARY_MAX_LENGTH - 3))).toBe(true)
  })
})

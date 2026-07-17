import { describe, expect, test } from "bun:test"
import { GOAL_TEMPLATE } from "./goal"

describe("GOAL_TEMPLATE", () => {
  test("describes /goal command surface", () => {
    expect(GOAL_TEMPLATE).toContain("/goal <objective>")
    expect(GOAL_TEMPLATE).toContain("/goal pause")
    expect(GOAL_TEMPLATE).toContain("/goal resume")
    expect(GOAL_TEMPLATE).toContain("/goal clear")
  })

  test("explains update_goal completion", () => {
    expect(GOAL_TEMPLATE).toContain('update_goal({ status: "complete" })')
  })
})

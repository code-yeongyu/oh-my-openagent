/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import {
  buildTasksSection,
  buildIntentRoutingSection,
  buildExecutionLoopSection,
} from "./dynamic-agent-core-sections"

describe("GLM shared builders", () => {
  test("buildTasksSection(true) uses task-system language", () => {
    const section = buildTasksSection(true)
    const lowerSection = section.toLowerCase()

    expect(lowerSection).toContain("task")
    expect(lowerSection).toContain("workflow")
  })

  test("buildTasksSection(false) uses todowrite reference", () => {
    const section = buildTasksSection(false)

    expect(section).toContain("todowrite")
  })

  test("both task variants mention the 2+ implementation steps threshold", () => {
    expect(buildTasksSection(true)).toContain("2+ implementation steps")
    expect(buildTasksSection(false)).toContain("2+ implementation steps")
  })

  test("buildIntentRoutingSection keeps the routing table when key triggers are empty", () => {
    const section = buildIntentRoutingSection("")

    expect(section).toContain("Intent routes:")
    expect(section).toContain("| Surface | True intent | GLM route |")
  })

  test("buildIntentRoutingSection includes all intent routes and re-entry rule", () => {
    const section = buildIntentRoutingSection("")

    expect(section).toContain("explain")
    expect(section).toContain("implement")
    expect(section).toContain("look into")
    expect(section).toContain("what do you think")
    expect(section).toContain("broken")
    expect(section).toContain("refactor")
    expect(section).toContain("<re_entry_rule>")
  })

  test("buildExecutionLoopSection includes execution states and verification tiers", () => {
    const section = buildExecutionLoopSection()

    expect(section).toContain("DISPATCH")
    expect(section).toContain("DELEGATE")
    expect(section).toContain("COLLECT")
    expect(section).toContain("SYNTHESIZE")
    expect(section).toContain("DONE")
    expect(section).toContain("<verification_tiers>")
    expect(section).toContain("V1")
    expect(section).toContain("V2")
    expect(section).toContain("V3")
  })

  test("buildExecutionLoopSection includes patch guidance text", () => {
    const section = buildExecutionLoopSection("patch guidance")

    expect(section).toContain("patch guidance")
  })
})

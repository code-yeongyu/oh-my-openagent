import { describe, expect, test } from "bun:test"

import { backgroundConversionText, backgroundStartText } from "./start-presentation"

const STARTED = {
  kind: "started" as const,
  task_id: "st_00000001",
  status: "running" as const,
  name: "auditor",
}

describe("backgroundStartText", () => {
  test("#given a task_summary #when the start text is built #then the summary labels the task over description and name", () => {
    // given / when / then
    expect(backgroundStartText(STARTED, { taskSummary: "Audit the boundary", description: "auditing" })).toContain(
      "Started task Audit the boundary (st_00000001, running)",
    )
  })

  test("#given only a description #when the start text is built #then the description labels the task", () => {
    // given / when / then
    expect(backgroundStartText(STARTED, { description: "auditing" })).toContain("Started task auditing (st_00000001, running)")
  })

  test("#given no labels #when the start text is built #then the name is used and the id form stays stable", () => {
    // given / when / then
    expect(backgroundStartText(STARTED, {})).toContain("Started task auditor (st_00000001, running)")
    expect(backgroundStartText({ ...STARTED, name: STARTED.task_id }, {})).toContain("Started task st_00000001 (running)")
  })
})

describe("backgroundConversionText", () => {
  test("#given a foreground task promoted at its prompt-cache-safe budget #when the conversion text is built #then it keeps the budget line and adds the task_output tail peek with the respawn hint", () => {
    // given / when
    const text = backgroundConversionText(STARTED, { taskSummary: "Audit the boundary" }, 270)

    // then
    expect(text).toContain("prompt-cache-safe budget (270s)")
    expect(text).toContain('task_output(task_id: "st_00000001", mode: "tail")')
    expect(text).toContain("4 peeks")
    expect(text).toContain("smaller subtasks")
  })
})

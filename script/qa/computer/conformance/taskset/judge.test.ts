import { describe, expect, test } from "bun:test"

import { taskFailure } from "./judge.ts"
import { TASKS } from "./tasks.ts"

const [task] = TASKS
if (task === undefined) throw new Error("the task set is empty")
const asDeclared = Object.fromEntries(task.oracle.map((expected) => [expected.field, expected.equals]))

describe("task-set judging used by run.ts --taskset", () => {
  test("a task passes only when the fixture's saved document holds every declared field", () => {
    expect(taskFailure(task, { saved: asDeclared, cells: task.cells.length })).toBeUndefined()
    const [first] = task.oracle
    const field = first?.field ?? ""
    expect(taskFailure(task, { saved: { ...asDeclared, [field]: "something else" }, cells: task.cells.length })).toBe(
      `saved fields not as declared: ${field}`,
    )
    expect(taskFailure(task, { saved: {}, cells: task.cells.length })).toContain("saved fields not as declared")
  })

  test("a replay that needed more than six cells fails even with the right saved document", () => {
    expect(taskFailure(task, { saved: asDeclared, cells: 7 })).toBe("used 7 cells, more than 6")
  })
})

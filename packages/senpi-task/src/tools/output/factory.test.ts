import { describe, expect, test } from "bun:test"

import { TaskListParams, createTaskListTool } from "./list"
import { TaskOutputParams, createTaskOutputTool } from "./output"
import type { ListManager, OutputManager } from "./types"

const listManager: ListManager = { list: () => [] }
const outputManager: OutputManager = { get: () => undefined, list: () => [] }

describe("output tool factories", () => {
  test("#given the two factories #when built #then names, labels, and TypeBox params are wired", () => {
    // given / when
    const list = createTaskListTool({ manager: listManager })
    const output = createTaskOutputTool({ manager: outputManager, stateDir: "/tmp/state" })

    // then
    expect(list.name).toBe("task_list")
    expect(list.parameters).toBe(TaskListParams)
    expect(output.name).toBe("task_output")
    expect(output.parameters).toBe(TaskOutputParams)
    for (const tool of [list, output]) {
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.label.length).toBeGreaterThan(0)
    }
  })
})

import { describe, expect, test } from "bun:test"

import { TaskOutputParams, createTaskOutputTool } from "./output"
import type { OutputManager } from "./types"

const outputManager: OutputManager = { get: () => undefined, list: () => [] }

describe("output tool factories", () => {
  test("#given the output factory #when built #then name, label, and TypeBox params are wired", () => {
    // given / when
    const output = createTaskOutputTool({ manager: outputManager, stateDir: "/tmp/state" })

    // then
    expect(output.name).toBe("task_output")
    expect(output.parameters).toBe(TaskOutputParams)
    expect(output.label.length).toBeGreaterThan(0)
    expect(typeof output.renderCall).toBe("function")
    expect(typeof output.renderResult).toBe("function")
  })
})

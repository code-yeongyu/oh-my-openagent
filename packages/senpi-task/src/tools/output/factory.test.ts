import { describe, expect, test } from "bun:test"

import { TaskOutputParams, createTaskOutputTool } from "./output"
import type { OutputManager } from "./types"

const outputManager: OutputManager = { get: () => undefined, list: () => [], waitFor: () => Promise.reject(new Error("unused")) }
const waitConfig = { min_ms: 5000, default_ms: 60000, max_ms: 600000 } as const

describe("output tool factories", () => {
  test("#given the output factory #when built #then name, label, and TypeBox params are wired", () => {
    // given / when
    const output = createTaskOutputTool({ manager: outputManager, stateDir: "/tmp/state", waitConfig })

    // then
    expect(output.name).toBe("task_output")
    expect(output.parameters).toBe(TaskOutputParams)
    expect(output.description.length).toBeGreaterThan(0)
    expect(output.label.length).toBeGreaterThan(0)
    expect(typeof output.renderCall).toBe("function")
    expect(typeof output.renderResult).toBe("function")
  })
})

import { describe, expect, test } from "bun:test"

import { boundedTaskOutput } from "./task-rpc-codec"

describe("boundedTaskOutput", () => {
  test("bounds no-progress status results without requiring snapshot or transcript fields", () => {
    const details = {
      kind: "no_progress",
      task_id: `st_${"x".repeat(300)}`,
      status: "running",
      reason: "x".repeat(2_001),
    } as const

    expect(boundedTaskOutput(details)).toEqual({
      ...details,
      task_id: details.task_id.slice(0, 256),
      reason: details.reason.slice(0, 2_000),
    })
  })
})

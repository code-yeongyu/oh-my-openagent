import { describe, expect, test } from "bun:test"

import { boundedTaskOutput } from "./task-rpc-codec"

describe("boundedTaskOutput", () => {
  test("preserves no-progress status results without requiring snapshot or transcript fields", () => {
    const details = {
      kind: "no_progress",
      task_id: "st_unchanged",
      status: "running",
      reason: "Task has not changed.",
    } as const

    expect(boundedTaskOutput(details)).toEqual(details)
  })
})

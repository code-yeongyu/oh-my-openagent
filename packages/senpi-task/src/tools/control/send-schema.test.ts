import { describe, expect, test } from "bun:test"

import { TaskSendParams } from "./send"

describe("TaskSendParams", () => {
  test("#given the task_send schema #when inspected #then it exposes to and hides old recipient keys", () => {
    const keys = Object.keys(TaskSendParams.properties)

    expect(keys).toContain("to")
    expect(keys).toContain("message")
    expect(keys).toContain("team_run_id")
    expect(keys).not.toContain("task_id")
    expect(keys).not.toContain("name")
  })
})

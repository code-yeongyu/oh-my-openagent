import { describe, expect, test } from "bun:test"

import { TASK_USAGE_GUIDANCE } from "./usage-guidance"

describe("task usage guidance", () => {
  test("#given the once-per-session task hint #when rendered #then it teaches steer-only team delivery without a blocking wait", () => {
    expect(TASK_USAGE_GUIDANCE).toContain("steered into the recipient's running turn")
    expect(TASK_USAGE_GUIDANCE).toContain("task_send")
    expect(TASK_USAGE_GUIDANCE).toContain("end your turn")
    expect(TASK_USAGE_GUIDANCE).toContain("never queues as editable follow-up work")
    expect(TASK_USAGE_GUIDANCE).not.toContain("revives resident members with follow-up work")
    expect(TASK_USAGE_GUIDANCE).not.toContain("team_wait")
  })

  test("#given background task guidance #when rendered #then it makes idle wake unconditional and limits midpoint inspection", () => {
    // given / when
    const guidance = TASK_USAGE_GUIDANCE

    // then
    expect(guidance).toContain("idle session is always woken")
    expect(guidance).toContain("one midpoint")
    expect(guidance).toContain("end your turn")
    expect(guidance).not.toContain("read progress")
  })

  test("#given the hidden usage hint #when responsibilities are inspected #then invocation syntax stays on the tool surface", () => {
    // then
    expect(TASK_USAGE_GUIDANCE).not.toContain("task({")
    expect(TASK_USAGE_GUIDANCE).toContain("task_output")
    expect(TASK_USAGE_GUIDANCE).toContain("task_send")
  })
})

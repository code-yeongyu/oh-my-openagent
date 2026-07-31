import { describe, expect, test } from "bun:test"

import { taskResultLines } from "./renderers"

describe("taskResultLines run stats", () => {
  test("#given terminal details with run stats #when rendered #then runtime and tps tokens are appended", () => {
    // given
    const details = {
      task_id: "st_00000009",
      status: "completed",
      mode: "spawn" as const,
      category: "deep",
      execution_mode: "in-process",
      model: "kimi-coding/kimi-k3-unlocked",
      run_in_background: false,
      run_stats: {
        runtime_ms: 134_000,
        turns: 3,
        tool_calls: 5,
        output_tokens: 900,
        total_tokens: 4_200,
        generation_ms: 7_600,
        tokens_per_second: 118,
      },
    }

    // when
    const [line = ""] = taskResultLines(details)

    // then
    expect(line).toContain("ran:2m14s")
    expect(line).toContain("tps:118")
  })

  test("#given details without run stats #when rendered #then no runtime tokens appear", () => {
    // when
    const [line = ""] = taskResultLines({ task_id: "st_00000009", status: "completed", mode: "spawn" as const })

    // then
    expect(line).not.toContain("ran:")
    expect(line).not.toContain("tps:")
  })
})

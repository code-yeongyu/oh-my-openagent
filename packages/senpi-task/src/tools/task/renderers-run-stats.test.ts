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

  test("#given run stats with cost and cache hits #when rendered #then cost then ch then tps tokens appear in order", () => {
    // given
    const details = {
      task_id: "st_00000009",
      status: "completed",
      mode: "spawn" as const,
      run_in_background: false,
      run_stats: {
        runtime_ms: 134_000,
        turns: 3,
        tool_calls: 5,
        output_tokens: 900,
        tokens_per_second: 118,
        cost_usd: 0.42131,
        cache_hit_rate: 0.8712,
      },
    }

    // when
    const [line = ""] = taskResultLines(details)

    // then: 4-decimal cost, integer percent cache hit, and tps last
    expect(line).toContain("cost:$0.4213")
    expect(line).toContain("ch:87%")
    expect(line.indexOf("cost:$0.4213")).toBeLessThan(line.indexOf("ch:87%"))
    expect(line.indexOf("ch:87%")).toBeLessThan(line.indexOf("tps:118"))
  })

  test("#given run stats without cost or cache facts #when rendered #then neither token appears", () => {
    // when
    const [line = ""] = taskResultLines({
      task_id: "st_00000009",
      status: "completed",
      mode: "spawn" as const,
      run_stats: { runtime_ms: 1_000, turns: 1, tool_calls: 0, tokens_per_second: 10 },
    })

    // then
    expect(line).not.toContain("cost:")
    expect(line).not.toContain("ch:")
    expect(line).toContain("tps:10")
  })

  test("#given malformed persisted spend facts #when rendered #then impossible money and cache values are omitted", () => {
    // when
    const [line = ""] = taskResultLines({
      task_id: "st_00000009",
      status: "completed",
      mode: "spawn" as const,
      run_stats: {
        runtime_ms: 1_000,
        turns: 1,
        tool_calls: 0,
        tokens_per_second: 10,
        cost_usd: Number.POSITIVE_INFINITY,
        cache_hit_rate: 2,
      },
    })

    // then
    expect(line).not.toContain("cost:")
    expect(line).not.toContain("ch:")
    expect(line).toContain("tps:10")
  })

  test("#given details without run stats #when rendered #then no runtime tokens appear", () => {
    // when
    const [line = ""] = taskResultLines({ task_id: "st_00000009", status: "completed", mode: "spawn" as const })

    // then
    expect(line).not.toContain("ran:")
    expect(line).not.toContain("tps:")
  })
})

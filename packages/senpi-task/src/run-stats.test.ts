import { describe, expect, test } from "bun:test"

import { createRunStatsTracker } from "./run-stats"

describe("run stats tracker", () => {
  test("#given assistant turns with usage #when snapshotted #then totals and tps derive from generation time", () => {
    // given
    let nowMs = 1_000
    const tracker = createRunStatsTracker(1_000, () => nowMs)

    // when: first generation window 1s -> 100 output tokens
    nowMs = 2_000
    tracker.accept({ type: "message_start", message: { role: "assistant", content: [] } })
    nowMs = 3_000
    tracker.accept({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "hi" }], usage: { output: 100, totalTokens: 400 } },
    })
    tracker.accept({ type: "tool_execution_start", toolName: "read", args: {} })
    nowMs = 9_000
    tracker.accept({ type: "tool_execution_end", toolName: "read" })
    // second generation window 1s -> 50 output tokens (no message_start: boundary comes from tool end)
    nowMs = 10_000
    tracker.accept({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "done" }], usage: { output: 50, totalTokens: 600 } },
    })

    // then
    expect(tracker.snapshot(11_000)).toEqual({
      runtime_ms: 10_000,
      turns: 2,
      tool_calls: 1,
      output_tokens: 150,
      total_tokens: 1_000,
      generation_ms: 2_000,
      tokens_per_second: 75,
    })
  })

  test("#given non-assistant messages and missing usage #when snapshotted #then only counted facts appear", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 1_500)

    // when
    tracker.accept({ type: "message_end", message: { role: "user", content: "hello" } })
    tracker.accept({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } })

    // then
    expect(tracker.snapshot(2_000)).toEqual({
      runtime_ms: 1_000,
      turns: 1,
      tool_calls: 0,
      generation_ms: 500,
    })
  })

  test("#given snake_case usage fields #when accumulated #then they are read as a fallback", () => {
    // given
    let nowMs = 1_000
    const tracker = createRunStatsTracker(1_000, () => nowMs)

    // when
    nowMs = 2_000
    tracker.accept({
      type: "message_end",
      message: { role: "assistant", content: [], usage: { output_tokens: 30, total_tokens: 90 } },
    })

    // then
    const snapshot = tracker.snapshot(2_000)
    expect(snapshot.output_tokens).toBe(30)
    expect(snapshot.total_tokens).toBe(90)
    expect(snapshot.tokens_per_second).toBe(30)
  })

  test("#given a sub-10 tps run #when snapshotted #then tps keeps one decimal", () => {
    // given
    let nowMs = 1_000
    const tracker = createRunStatsTracker(1_000, () => nowMs)

    // when: 10 tokens over 4s -> 2.5 tok/s
    nowMs = 5_000
    tracker.accept({
      type: "message_end",
      message: { role: "assistant", content: [], usage: { output: 10, totalTokens: 10 } },
    })

    // then
    expect(tracker.snapshot(5_000).tokens_per_second).toBe(2.5)
  })

  test("#given message_start before message_end #when snapshotted #then the window is the arrival-clock gap", () => {
    // given
    let nowMs = 10_000
    const tracker = createRunStatsTracker(10_000, () => nowMs)

    // when: streaming observed from arrival of message_start to arrival of message_end
    tracker.accept({ type: "message_start", message: { role: "assistant", content: [] } })
    nowMs = 13_000
    tracker.accept({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "done" }], usage: { output: 300, totalTokens: 600 } },
    })

    // then
    const snapshot = tracker.snapshot(13_000)
    expect(snapshot.generation_ms).toBe(3_000)
    expect(snapshot.tokens_per_second).toBe(100)
  })

  test("#given bursty delivery collapsing the only generation window #when snapshotted #then tps is omitted as unverifiable", () => {
    // given
    let nowMs = 1_000
    const tracker = createRunStatsTracker(1_000, () => nowMs)

    // when: message_end arrives at the same millisecond as spawn (post-hoc burst)
    tracker.accept({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "done" }], usage: { output: 400, totalTokens: 900 } },
    })

    // then: the single token-bearing generation window collapsed to zero measured duration, so
    // generation throughput is unknowable (runtime would conflate tool/idle time with streaming
    // speed). tokens_per_second MUST be absent, not a runtime-derived substitute.
    const snapshot = tracker.snapshot(3_000)
    expect(snapshot.generation_ms).toBeUndefined()
    expect(snapshot.tokens_per_second).toBeUndefined()
  })

  test("#given multiple cache-bearing turns #when snapshotted #then latest-request and whole-run cache hit rates stay distinct", () => {
    // given
    let nowMs = 1_000
    const tracker = createRunStatsTracker(1_000, () => nowMs)

    // when: first turn is 60% cache hit, second (latest) turn is 90%
    nowMs = 2_000
    tracker.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 10, totalTokens: 70, cost: 0.0125 },
      },
    })
    tracker.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        usage: { input: 10, output: 20, cacheRead: 90, cacheWrite: 0, totalTokens: 120, cost: 0.01 },
      },
    })

    // then: cost sums; the live/status rate is the latest request's 90 / 100 while the persisted
    // whole-run rate remains (30 + 90) / ((10+30+10) + (10+90+0)) = 120 / 150.
    const snapshot = tracker.snapshot(2_000)
    expect(snapshot.cost_usd).toBeCloseTo(0.0225, 10)
    expect(snapshot.cache_hit_rate_last).toBeCloseTo(90 / 100, 10)
    expect(snapshot.cache_hit_rate_run).toBeCloseTo(120 / 150, 10)
  })

  test("#given cost as an object with a total #when snapshotted #then the total is summed", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)

    // when
    tracker.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        usage: { input: 5, output: 5, cacheRead: 5, cacheWrite: 0, cost: { input: 0.1, output: 0.2, total: 0.3 } },
      },
    })

    // then
    expect(tracker.snapshot(2_000).cost_usd).toBeCloseTo(0.3, 10)
  })

  test("#given usage without cache or cost facts #when snapshotted #then both fields are omitted", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)

    // when: zero cacheable denominator and no cost
    tracker.accept({
      type: "message_end",
      message: { role: "assistant", content: [], usage: { output: 40, totalTokens: 40 } },
    })

    // then
    const snapshot = tracker.snapshot(2_000)
    expect(snapshot.cost_usd).toBeUndefined()
    expect(snapshot.cache_hit_rate_last).toBeUndefined()
    expect(snapshot.cache_hit_rate_run).toBeUndefined()
  })

  test("#given snake_case cache fields and zero cache reads #when snapshotted #then the rate is zero not omitted", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)

    // when
    tracker.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 20 },
      },
    })

    // then
    expect(tracker.snapshot(2_000).cache_hit_rate_last).toBe(0)
    expect(tracker.snapshot(2_000).cache_hit_rate_run).toBe(0)
  })

  test("#given non-finite cost and negative cache inputs #when snapshotted #then unsafe values cannot poison persisted stats", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)

    // when: JSON.parse accepts 1e400 as Infinity, and an RPC child can report negative counters
    tracker.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        usage: JSON.parse(
          '{"input":-10,"output":5,"cacheRead":30,"cacheWrite":-5,"totalTokens":20,"cost":1e400}',
        ),
      },
    })

    // then: invalid facts are ignored; the remaining 30 cache-read tokens form a bounded 100% rate
    const snapshot = tracker.snapshot(2_000)
    expect(snapshot.cost_usd).toBeUndefined()
    expect(snapshot.cache_hit_rate_last).toBe(1)
    expect(snapshot.cache_hit_rate_run).toBe(1)
    expect(JSON.stringify(snapshot)).not.toContain("null")
  })

  test("#given an object cost with a non-finite total #when snapshotted #then cost is omitted", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)

    // when
    tracker.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        usage: { input: 10, cacheRead: 0, cacheWrite: 0, cost: { total: Number.POSITIVE_INFINITY } },
      },
    })

    // then
    expect(tracker.snapshot(2_000).cost_usd).toBeUndefined()
  })

  test("#given finite values that overflow cumulative totals #when snapshotted #then non-finite metrics are omitted", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)
    const overflowingTurn = {
      type: "message_end" as const,
      message: {
        role: "assistant",
        content: [],
        usage: { input: 0, cacheRead: 1e308, cacheWrite: 0, cost: 1e308 },
      },
    }

    // when: every individual value is finite, but the two-turn sums overflow
    tracker.accept(overflowingTurn)
    tracker.accept(overflowingTurn)

    // then
    const snapshot = tracker.snapshot(2_000)
    expect(snapshot.cost_usd).toBeUndefined()
    expect(snapshot.cache_hit_rate_last).toBe(1)
    expect(snapshot.cache_hit_rate_run).toBeUndefined()
    expect(JSON.stringify(snapshot)).not.toContain("null")
  })

  test("#given a later assistant turn without a cacheable denominator #when snapshotted #then the latest valid request rate is retained", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)
    tracker.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        usage: { input: 10, cacheRead: 90, cacheWrite: 0 },
      },
    })

    // when: a later assistant turn reports no cacheable input facts
    tracker.accept({
      type: "message_end",
      message: { role: "assistant", content: [], usage: { output: 10, totalTokens: 10 } },
    })

    // then
    expect(tracker.snapshot(2_000).cache_hit_rate_last).toBeCloseTo(0.9, 10)
    expect(tracker.snapshot(2_000).cache_hit_rate_run).toBeCloseTo(0.9, 10)
  })

  test("#given one measured window and one token-bearing collapsed window #when snapshotted #then tps is omitted as unverifiable", () => {
    // given
    let nowMs = 1_000
    const tracker = createRunStatsTracker(1_000, () => nowMs)

    // when: first turn measures 2s of generation, second turn arrives in the same ms (burst)
    nowMs = 2_000
    tracker.accept({ type: "message_start", message: { role: "assistant", content: [] } })
    nowMs = 4_000
    tracker.accept({
      type: "message_end",
      message: { role: "assistant", content: [], usage: { output: 100, totalTokens: 200 } },
    })
    tracker.accept({
      type: "message_end",
      message: { role: "assistant", content: [], usage: { output: 300, totalTokens: 600 } },
    })

    // then: one measured window (2s) and one token-bearing collapsed window (0s). Dividing all
    // 400 output tokens by only the measured 2s would overstate tps; dividing by runtime would
    // conflate streaming speed with tool/idle time. Either way the collapsed portion's timing is
    // lost, so generation throughput is UNKNOWABLE and tokens_per_second MUST be absent.
    const snapshot = tracker.snapshot(10_000)
    expect(snapshot.runtime_ms).toBe(9_000)
    expect(snapshot.output_tokens).toBe(400)
    expect(snapshot.total_tokens).toBe(800)
    expect(snapshot.generation_ms).toBe(2_000)
    expect(snapshot.tokens_per_second).toBeUndefined()
  })
})

import { describe, expect, test } from "bun:test"

import { createRunStatsTracker } from "./run-stats"

// The exact usage payload a provider error emits alongside stopReason "error": every bucket
// zeroed, cost included as an all-zero breakdown. Nothing executed, so nothing may be counted.
const ZEROED_FAILURE_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
} as const

describe("run stats failed-turn accounting", () => {
  test("#given an errored assistant turn with zeroed usage #when snapshotted #then it counts as failed, never as a turn", () => {
    // given
    let nowMs = 1_000
    const tracker = createRunStatsTracker(1_000, () => nowMs)

    // when: a provider error ends the turn with the measured all-zero usage payload
    nowMs = 2_000
    tracker.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "provider request failed",
        usage: ZEROED_FAILURE_USAGE,
      },
    })

    // then: no successful turn exists, so no token, cost or generation facts may be reported -
    // the failure is visible only through failed_turns.
    expect(tracker.snapshot(3_000)).toEqual({
      runtime_ms: 2_000,
      turns: 0,
      failed_turns: 1,
      tool_calls: 0,
      duration_status: "monotonic",
      token_status: "unavailable",
      cost_status: "unavailable",
    })
  })

  test("#given an aborted assistant turn with zeroed usage #when snapshotted #then it counts as failed, never as a turn", () => {
    // given
    let nowMs = 1_000
    const tracker = createRunStatsTracker(1_000, () => nowMs)

    // when
    nowMs = 2_000
    tracker.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "aborted",
        usage: ZEROED_FAILURE_USAGE,
      },
    })

    // then
    expect(tracker.snapshot(3_000)).toEqual({
      runtime_ms: 2_000,
      turns: 0,
      failed_turns: 1,
      tool_calls: 0,
      duration_status: "monotonic",
      token_status: "unavailable",
      cost_status: "unavailable",
    })
  })

  test("#given a mixed run of one successful and two failed turns #when snapshotted #then only the successful turn contributes facts", () => {
    // given
    let nowMs = 1_000
    const tracker = createRunStatsTracker(1_000, () => nowMs)

    // when: a successful turn, then an errored one, then an aborted one carrying non-zero usage
    nowMs = 2_000
    tracker.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        usage: { input: 100, output: 40, totalTokens: 140, cost: 0.02 },
      },
    })
    nowMs = 2_500
    tracker.accept({
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "error", usage: ZEROED_FAILURE_USAGE },
    })
    nowMs = 3_000
    tracker.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "aborted",
        usage: { input: 300, output: 999, totalTokens: 1_299, cost: 0.5 },
      },
    })

    // then: turns counts the successful turn only; coverage describes that turn only; the
    // aborted turn's non-zero usage and cost contribute nothing.
    const snapshot = tracker.snapshot(4_000)
    expect(snapshot.turns).toBe(1)
    expect(snapshot.failed_turns).toBe(2)
    expect(snapshot.output_tokens).toBe(40)
    expect(snapshot.total_tokens).toBe(140)
    expect(snapshot.cost_usd).toBeCloseTo(0.02, 10)
    expect(snapshot.token_status).toBe("complete")
    expect(snapshot.cost_status).toBe("reported")
  })

  test("#given a successful turn whose usage is the all-zero placeholder #when snapshotted #then neither tokens nor cost are reported", () => {
    // given
    let nowMs = 1_000
    const tracker = createRunStatsTracker(1_000, () => nowMs)

    // when: the provider streamed no usage, so the engine's zero-filled usage object is all the turn carries
    nowMs = 2_000
    tracker.accept({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "done" }], usage: ZEROED_FAILURE_USAGE },
    })

    // then: an unreported usage is not a $0 cost - the row must show no spend instead of $0.0000 (#10724)
    const snapshot = tracker.snapshot(3_000)
    expect(snapshot.turns).toBe(1)
    expect(snapshot.cost_usd).toBeUndefined()
    expect(snapshot.cost_status).toBe("unavailable")
    expect(snapshot.token_status).toBe("unavailable")
  })

  test("#given a zero-priced model reporting real tokens #when snapshotted #then its genuine zero cost stays reported", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)

    // when: tokens were billed at a zero price
    tracker.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        usage: { ...ZEROED_FAILURE_USAGE, input: 1_000, output: 100, totalTokens: 1_100 },
      },
    })

    // then
    const snapshot = tracker.snapshot(3_000)
    expect(snapshot.cost_usd).toBe(0)
    expect(snapshot.cost_status).toBe("reported")
    expect(snapshot.token_status).toBe("complete")
  })

  test("#given one turn with usage and one with the zero placeholder #when snapshotted #then totals cover the reporting turn and coverage is partial", () => {
    // given
    let nowMs = 1_000
    const tracker = createRunStatsTracker(1_000, () => nowMs)

    // when
    nowMs = 2_000
    tracker.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "first" }],
        usage: { input: 1_000, output: 100, totalTokens: 1_100, cost: { total: 0.00184 } },
      },
    })
    nowMs = 3_000
    tracker.accept({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "second" }], usage: ZEROED_FAILURE_USAGE },
    })

    // then: the placeholder turn contributes nothing, and the totals say they are a lower bound
    const snapshot = tracker.snapshot(4_000)
    expect(snapshot.turns).toBe(2)
    expect(snapshot.total_tokens).toBe(1_100)
    expect(snapshot.cost_usd).toBeCloseTo(0.00184, 10)
    expect(snapshot.cost_status).toBe("partial")
    expect(snapshot.token_status).toBe("partial")
  })

  test("#given a failed turn carrying non-zero usage #when snapshotted #then none of its tokens or cost are counted", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)

    // when: the provider streamed tokens and reported cost before the turn errored
    tracker.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "partial" }],
        stopReason: "error",
        usage: { input: 700, output: 500, totalTokens: 1_200, cost: 0.75 },
      },
    })

    // then: a failed turn's partial facts are not run facts
    const snapshot = tracker.snapshot(2_000)
    expect(snapshot.turns).toBe(0)
    expect(snapshot.failed_turns).toBe(1)
    expect(snapshot.output_tokens).toBeUndefined()
    expect(snapshot.total_tokens).toBeUndefined()
    expect(snapshot.input_tokens).toBeUndefined()
    expect(snapshot.cost_usd).toBeUndefined()
    expect(snapshot.token_status).toBe("unavailable")
    expect(snapshot.cost_status).toBe("unavailable")
    expect(snapshot.generation_ms).toBeUndefined()
    expect(snapshot.tokens_per_second).toBeUndefined()
  })

  test("#given a failed turn between spawn and a successful turn #when the successful window is measured #then the failure re-anchors it instead of inflating it", () => {
    // given
    let nowMs = 1_000
    const tracker = createRunStatsTracker(1_000, () => nowMs)

    // when: the failed turn lands 4s after spawn, the successful one 1s after that
    nowMs = 5_000
    tracker.accept({
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "error", usage: ZEROED_FAILURE_USAGE },
    })
    nowMs = 6_000
    tracker.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "recovered" }],
        usage: { output: 100, totalTokens: 200 },
      },
    })

    // then: the successful window spans failure-to-success (1s), not spawn-to-success (5s), so
    // the failure's wall time cannot masquerade as generation time.
    const snapshot = tracker.snapshot(7_000)
    expect(snapshot.turns).toBe(1)
    expect(snapshot.failed_turns).toBe(1)
    expect(snapshot.generation_ms).toBe(1_000)
    expect(snapshot.tokens_per_second).toBe(100)
  })
})

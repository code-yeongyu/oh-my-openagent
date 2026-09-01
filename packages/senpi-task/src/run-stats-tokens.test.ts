import { describe, expect, test } from "bun:test"

import { createRunStatsTracker } from "./run-stats"

describe("run stats token totals and data-quality statuses", () => {
  test("#given assistant turns reporting input/cacheRead/cacheWrite #when snapshot is taken #then input_tokens, cache_read_tokens and cache_write_tokens are summed and omitted when unreported", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)

    // when
    tracker.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        usage: { input: 120, output: 40, cacheRead: 900, cacheWrite: 300, totalTokens: 1_360 },
      },
    })
    tracker.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        usage: { input: 80, output: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, totalTokens: 190 },
      },
    })

    // then
    const snapshot = tracker.snapshot(2_000)
    expect(snapshot.input_tokens).toBe(200)
    expect(snapshot.cache_read_tokens).toBe(1_000)
    expect(snapshot.cache_write_tokens).toBe(300)
    expect(snapshot.output_tokens).toBe(50)

    // and: a run whose turns report no usage at all omits every token total
    const bare = createRunStatsTracker(1_000, () => 2_000)
    bare.accept({ type: "message_end", message: { role: "assistant", content: [] } })
    const bareSnapshot = bare.snapshot(2_000)
    expect(bareSnapshot.input_tokens).toBeUndefined()
    expect(bareSnapshot.cache_read_tokens).toBeUndefined()
    expect(bareSnapshot.cache_write_tokens).toBeUndefined()
  })

  test("#given every assistant turn reporting usage #when snapshot is taken #then token_status is complete", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)

    // when
    tracker.accept({
      type: "message_end",
      message: { role: "assistant", content: [], usage: { input: 10, output: 5, totalTokens: 15 } },
    })

    // then
    expect(tracker.snapshot(2_000).token_status).toBe("complete")
  })

  test("#given one turn with usage and one without #when snapshot is taken #then token_status is partial", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)

    // when
    tracker.accept({
      type: "message_end",
      message: { role: "assistant", content: [], usage: { input: 10, output: 5, totalTokens: 15 } },
    })
    tracker.accept({ type: "message_end", message: { role: "assistant", content: [] } })

    // then
    expect(tracker.snapshot(2_000).token_status).toBe("partial")
  })

  test("#given no turn reporting usage #when snapshot is taken #then token_status is unavailable", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)

    // when
    tracker.accept({ type: "message_end", message: { role: "assistant", content: [] } })

    // then
    expect(tracker.snapshot(2_000).token_status).toBe("unavailable")
  })

  test("#given a provider-reported zero cost #when snapshot is taken #then cost_usd is 0 with cost_status reported while an absent cost is unavailable", () => {
    // given
    const reported = createRunStatsTracker(1_000, () => 2_000)
    const silent = createRunStatsTracker(1_000, () => 2_000)

    // when
    reported.accept({
      type: "message_end",
      message: { role: "assistant", content: [], usage: { input: 10, output: 5, cost: 0 } },
    })
    silent.accept({
      type: "message_end",
      message: { role: "assistant", content: [], usage: { input: 10, output: 5 } },
    })

    // then
    const reportedSnapshot = reported.snapshot(2_000)
    expect(reportedSnapshot.cost_usd).toBe(0)
    expect(reportedSnapshot.cost_status).toBe("reported")
    const silentSnapshot = silent.snapshot(2_000)
    expect(silentSnapshot.cost_usd).toBeUndefined()
    expect(silentSnapshot.cost_status).toBe("unavailable")
  })

  test("#given a tracker measuring the live run #when snapshot is taken #then duration_status is monotonic", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)

    // when
    tracker.accept({ type: "message_end", message: { role: "assistant", content: [], usage: { output: 5 } } })

    // then
    expect(tracker.snapshot(2_000).duration_status).toBe("monotonic")
  })
})

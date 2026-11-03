import { describe, expect, test } from "bun:test"

import { createTurnWakeSources } from "./turn-wake-sources"

function extensionEvent(name: string, data: unknown): unknown {
  return { type: "extension_event", name, data }
}

describe("createTurnWakeSources (senpi#3262)", () => {
  test("#given a goal continuation armed #when the timer reports armed #then the wake tracker is live and stays live until it disarms", () => {
    // given
    const tracker = createTurnWakeSources()

    // when - the goal builtin reports an armed continuation timer (its providerRecovery path)
    tracker.observe(extensionEvent("goal_continuation_timer_state", { armed: true, kind: "providerRecovery" }))

    // then
    expect(tracker.hasLiveWakeSources()).toBe(true)

    // when - the timer fires or is cancelled
    tracker.observe(extensionEvent("goal_continuation_timer_state", { armed: false, kind: "providerRecovery" }))

    // then
    expect(tracker.hasLiveWakeSources()).toBe(false)
  })

  test("#given a terminal monitor watch registered #when its state rides the wire #then the tracker tracks it until every watch ends", () => {
    // given
    const tracker = createTurnWakeSources()

    // when - a monitor snapshot with one live watch
    tracker.observe(
      extensionEvent("terminal_monitor_state", {
        activeCount: 1,
        monitors: [{ id: "w1", description: "watch the build", startedAtMs: 1 }],
      }),
    )

    // then
    expect(tracker.hasLiveWakeSources()).toBe(true)

    // when - the watch's snapshot goes quiet
    tracker.observe(extensionEvent("terminal_monitor_state", { activeCount: 0, monitors: [] }))

    // then
    expect(tracker.hasLiveWakeSources()).toBe(false)
  })

  test("#given a non-lifecycle extension event #when observed #then the tracker ignores it", () => {
    // given
    const tracker = createTurnWakeSources()

    // when - a permission prompt and an unrelated record
    tracker.observe(extensionEvent("computer.permission_required", { type: "computer.permission_required", permission: "screen_recording" }))
    tracker.observe({ type: "agent_end", willRetry: false })

    // then
    expect(tracker.hasLiveWakeSources()).toBe(false)
  })

  test("#given a providerRetry goal timer (senpi#3319) #when armed then disarmed by kind #then only its own kind clears", () => {
    // given - a goal waiting out a provider outage on its retry backoff timer
    const tracker = createTurnWakeSources()
    tracker.observe(extensionEvent("goal_continuation_timer_state", { armed: true, kind: "providerRetry", dueAtMs: 9_000 }))
    tracker.observe(extensionEvent("goal_continuation_timer_state", { armed: true, kind: "monitor" }))
    expect(tracker.hasLiveWakeSources()).toBe(true)

    // when - the monitor timer disarms: the providerRetry timer is untouched
    tracker.observe(extensionEvent("goal_continuation_timer_state", { armed: false, kind: "monitor" }))

    // then
    expect(tracker.hasLiveWakeSources()).toBe(true)

    // when - the providerRetry timer itself disarms (the retry fired or the goal gave up)
    tracker.observe(extensionEvent("goal_continuation_timer_state", { armed: false, kind: "providerRetry" }))

    // then
    expect(tracker.hasLiveWakeSources()).toBe(false)
  })

  test("#given a live tracker #when a new turn begins #then turn-scoped goal timers clear but session monitors survive", () => {
    // given
    const tracker = createTurnWakeSources()
    tracker.observe(extensionEvent("goal_continuation_timer_state", { armed: true, kind: "providerRecovery" }))
    tracker.observe(
      extensionEvent("terminal_monitor_state", {
        activeCount: 1,
        monitors: [{ id: "w1", description: "watch the build", startedAtMs: 1 }],
      }),
    )
    expect(tracker.hasLiveWakeSources()).toBe(true)

    // when - a new turn begins
    tracker.resetTurn()

    // then - the goal timer belonged to the finished turn; the monitor lives for the session
    expect(tracker.hasLiveWakeSources()).toBe(true)

    // when - the engine itself reports the monitor set empty
    tracker.observe(extensionEvent("terminal_monitor_state", { activeCount: 0, monitors: [] }))

    // then
    expect(tracker.hasLiveWakeSources()).toBe(false)
  })
})

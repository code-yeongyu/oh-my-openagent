import { describe, expect, it } from "vitest"

import { startHeartbeat } from "../src/index.ts"
import { FakeScheduler } from "./support/scheduler.ts"

describe("stopPath.heartbeat from the host", () => {
  it("beats every 500 ms while the brain link is fresh", async () => {
    // Given a fresh brain link.
    const scheduler = new FakeScheduler()
    let beats = 0
    startHeartbeat({ scheduler, send: () => void (beats += 1), brainLastSeenMs: () => scheduler.now() })

    // When two seconds pass.
    await scheduler.advance(2_000)

    // Then four heartbeats went to the engine.
    expect(beats).toBe(4)
  })

  it("heartbeat_stops_when_brain_link_is_stale", async () => {
    // Given a brain link last seen at t=0 that then goes silent.
    const scheduler = new FakeScheduler()
    let lastSeen = 0
    const sent: number[] = []
    const stop = startHeartbeat({
      scheduler,
      send: () => void sent.push(scheduler.now()),
      brainLastSeenMs: () => lastSeen,
    })

    // When 20 s pass with no brain traffic.
    await scheduler.advance(20_000)

    // Then the last heartbeat is inside the 15 s window and none follows, so the engine's stop path goes stale.
    expect(Math.max(...sent)).toBeLessThan(15_000)
    expect(sent.filter((at) => at >= 15_000)).toEqual([])

    // When the brain is heard again, heartbeats resume; after stop() none is sent.
    lastSeen = scheduler.now()
    await scheduler.advance(1_000)
    expect(sent.filter((at) => at > 20_000)).toHaveLength(2)
    stop()
    await scheduler.advance(5_000)
    expect(sent.filter((at) => at > 21_000)).toEqual([])
  })
})

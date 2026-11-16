import { describe, expect, it } from "vitest"

import { startWatchdog } from "../src/index.ts"
import { FakeScheduler } from "./support/scheduler.ts"

describe("watchdog (spawning profile)", () => {
  it("watchdog_kills_after_35s_silence_and_bumps_generation", async () => {
    // Given an engine whose health probe stops answering at t=0, and a respawn that bumps the generation.
    const scheduler = new FakeScheduler()
    const healthy = false
    let generation = 1
    const kills: number[] = []
    const respawns: number[] = []
    startWatchdog({
      scheduler,
      probe: async () => healthy,
      kill: () => void kills.push(scheduler.now()),
      respawn: async () => {
        respawns.push(scheduler.now())
        generation += 1
      },
    })

    // When 34 s pass, nothing is killed; at the 35 s probe the engine is killed once.
    await scheduler.advance(34_000)
    expect(kills).toEqual([])
    await scheduler.advance(1_000)
    expect(kills).toEqual([35_000])

    // Then it respawns after the first backoff step (1 s) with the next generation.
    await scheduler.advance(1_000)
    expect(respawns).toEqual([36_000])
    expect(generation).toBe(2)

    // When every new generation stays silent too, each restart backs off twice as long (2 s, 4 s, ...)
    // and each kill comes at the first 5 s probe after 35 s of silence since that generation started.
    await scheduler.advance(200_000)
    expect(respawns.map((at, index) => at - (kills[index] ?? 0)).slice(0, 3)).toEqual([1_000, 2_000, 4_000])
    for (const [index, killedAt] of kills.entries()) {
      if (index === 0) continue
      const silence = killedAt - (respawns[index - 1] ?? 0)
      expect(silence).toBeGreaterThanOrEqual(35_000)
      expect(silence).toBeLessThan(40_000)
    }
  })

  it("probes every 5 s and a healthy answer resets the silence clock and the backoff", async () => {
    const scheduler = new FakeScheduler()
    let probes = 0
    let healthy = true
    const kills: number[] = []
    startWatchdog({
      scheduler,
      probe: async () => {
        probes += 1
        return healthy
      },
      kill: () => void kills.push(scheduler.now()),
      respawn: async () => undefined,
    })
    await scheduler.advance(60_000)
    expect(probes).toBe(12)
    expect(kills).toEqual([])
    healthy = false
    await scheduler.advance(34_999)
    expect(kills).toEqual([])
  })

  it("the backoff never exceeds 30 s", async () => {
    const scheduler = new FakeScheduler()
    const kills: number[] = []
    const respawns: number[] = []
    startWatchdog({
      scheduler,
      probe: async () => false,
      kill: () => void kills.push(scheduler.now()),
      respawn: async () => void respawns.push(scheduler.now()),
    })
    await scheduler.advance(20 * 70_000)
    const gaps = respawns.map((at, index) => at - (kills[index] ?? 0))
    expect(gaps.slice(0, 6)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000])
    expect(Math.max(...gaps)).toBe(30_000)
  })
})

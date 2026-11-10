import { describe, expect, test } from "bun:test"

import { TRANSIENT_RUN_MAX_AGE_MS } from "./transient-sweep"
import { scheduleTransientSweepOnce } from "./transient-sweep-once"

function uniqueRoot(): string {
  return `/memory-root-${crypto.randomUUID()}`
}

describe("scheduleTransientSweepOnce", () => {
  test("#given a long-lived engine process that swept at start #when sessions keep opening #then the next open after the run age bound claims a new sweep, and opens before it do not", () => {
    // given
    const memoryRoot = uniqueRoot()
    let clock = 1_000_000
    const claim = () => scheduleTransientSweepOnce({ memoryRoot, start: () => undefined, deferMs: 60_000, now: () => clock })
    const first = claim()

    // when
    clock += TRANSIENT_RUN_MAX_AGE_MS - 1
    const beforeBound = claim()
    clock += 1
    const atBound = claim()

    // then
    expect(first).toBeDefined()
    expect(beforeBound).toBeUndefined()
    expect(atBound).toBeDefined()
    first?.cancel()
    atBound?.cancel()
  })

  test("#given a claim whose deferred sweep already ran #when the clock passes the run age bound #then the next open claims and runs one more sweep", async () => {
    // given
    const memoryRoot = uniqueRoot()
    let clock = 1_000_000
    let sweeps = 0
    let swept: () => void = () => undefined
    const claim = () => scheduleTransientSweepOnce({
      memoryRoot,
      deferMs: 0,
      now: () => clock,
      start: () => {
        sweeps += 1
        swept()
      },
    })
    const firstSweep = new Promise<void>((resolve) => {
      swept = resolve
    })
    claim()
    await firstSweep

    // when
    clock += TRANSIENT_RUN_MAX_AGE_MS - 1
    const beforeBound = claim()
    clock += 1
    const secondSweep = new Promise<void>((resolve) => {
      swept = resolve
    })
    const atBound = claim()
    await secondSweep

    // then
    expect(beforeBound).toBeUndefined()
    expect(atBound).toBeDefined()
    expect(sweeps).toBe(2)
  })

  test("#given an old claim whose sweep never started and a newer claim on the same root #when the old session shuts down #then the newer claim survives", () => {
    // given
    const memoryRoot = uniqueRoot()
    let clock = 1_000_000
    const claim = () => scheduleTransientSweepOnce({ memoryRoot, start: () => undefined, deferMs: 60_000, now: () => clock })
    const old = claim()
    clock += TRANSIENT_RUN_MAX_AGE_MS
    const newer = claim()

    // when
    old?.cancel()
    const afterOldShutdown = claim()

    // then
    expect(newer).toBeDefined()
    expect(afterOldShutdown).toBeUndefined()
    newer?.cancel()
  })
})

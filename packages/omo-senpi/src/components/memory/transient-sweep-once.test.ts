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
})

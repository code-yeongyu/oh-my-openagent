import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

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
    const claim = () =>
      scheduleTransientSweepOnce({ memoryRoot, start: () => undefined, deferMs: 60_000, now: () => clock })
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
    const claim = () =>
      scheduleTransientSweepOnce({
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
    const claim = () =>
      scheduleTransientSweepOnce({ memoryRoot, start: () => undefined, deferMs: 60_000, now: () => clock })
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

  test("#given two registrations on one root #when the claimer shuts down before the deferred sweep #then exactly one sweep still runs while the second session stays open", async () => {
    // given (#12900 item 1: the claim hands over to the remaining registration)
    const memoryRoot = uniqueRoot()
    let sweeps = 0
    let swept: () => void = () => undefined
    const sweptOnce = new Promise<void>((resolve) => {
      swept = resolve
    })
    const start = () => {
      sweeps += 1
      swept()
    }
    const claimer = scheduleTransientSweepOnce({ memoryRoot, deferMs: 0, now: () => 1_000_000, start })
    // B registers on the same root before the deferred sweep starts: no claim, no cancel handle.
    const second = scheduleTransientSweepOnce({ memoryRoot, deferMs: 0, now: () => 1_000_000, start })

    // when: A, the claimer, shuts down before the 0 ms deferred sweep fired.
    claimer?.cancel()
    await sweptOnce

    // then: exactly one sweep runs while B stays open.
    expect(second).toBeUndefined()
    expect(sweeps).toBe(1)
    second?.cancel()
  })

  test("#given one memory root spelled twice #when both spellings register #then exactly one sweep runs", async () => {
    // given (#12900 item 2: the claim keys on the root's real path, so a trailing-separator or
    // symlinked spelling of the same directory is still the same root)
    const root = await mkdtemp(join(tmpdir(), "omo-sweep-key-"))
    let sweeps = 0
    let swept: () => void = () => undefined
    const sweptOnce = new Promise<void>((resolve) => {
      swept = resolve
    })
    const start = () => {
      sweeps += 1
      swept()
    }
    try {
      const first = scheduleTransientSweepOnce({ memoryRoot: root, deferMs: 0, now: () => 1_000_000, start })
      const respelled = scheduleTransientSweepOnce({
        memoryRoot: `${root}/`,
        deferMs: 0,
        now: () => 1_000_000,
        start,
      })

      // when
      await sweptOnce
      first?.cancel()
      respelled?.cancel()

      // then
      expect(respelled).toBeUndefined()
      expect(sweeps).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import * as resilientFs from "../fs/resilient"
import { LockContentionError, acquireLock, releaseLock } from "./acquire"
import { LOCK_RETRY_MAX_DELAY_MS, lockRetryDelayMs } from "./retry-delay"
import { memoryWriterLockPath } from "./domains"
import { createLockRecord } from "./lock-record"
import { RecallWakeBusyError, acquireRecallWakeLease, recallWakeTicketDirectory } from "./recall-wake-domain"

// Time is the behavior under test: a waiter polling at a fixed 25 ms makes ~40 reads per second for
// as long as the holder keeps the lock. The spies count the polls each wait loop makes.
const temporaryDirectories: string[] = []

async function createLocksDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "lock-wait-backoff-"))
  temporaryDirectories.push(directory)
  return directory
}

function countCalls(name: "readFile" | "readdir", target: string): { readonly count: () => number; readonly restore: () => void } {
  const spy = spyOn(resilientFs, name)
  return {
    count: () => spy.mock.calls.filter((call) => String(call[0]) === target).length,
    restore: () => spy.mockRestore(),
  }
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe("lock wait backoff", () => {
  test("#given the retry schedule #when attempts grow #then delays never shrink, stay positive, and never pass the cap", () => {
    // #given
    const extremes = [() => 0, () => 0.5, () => 0.999]

    // #when
    const schedules = extremes.map((random) => Array.from({ length: 40 }, (_, attempt) => lockRetryDelayMs(attempt, 5, random)))

    // #then
    for (const delays of schedules) {
      expect(delays.every((delay) => delay >= 1 && delay <= LOCK_RETRY_MAX_DELAY_MS)).toBe(true)
      expect(delays.every((delay, index) => index === 0 || delay >= (delays[index - 1] ?? 0))).toBe(true)
      expect(delays[0]).toBeLessThanOrEqual(5)
      expect(delays.at(-1)).toBeGreaterThan(LOCK_RETRY_MAX_DELAY_MS / 4)
    }
    expect(new Set(schedules.map((delays) => delays.at(-1))).size).toBeGreaterThan(1)
  })

  test("#given a live holder for a whole second #when a contender waits with a 5 ms base delay #then it polls a bounded number of times", async () => {
    // #given
    const lockPath = memoryWriterLockPath(await createLocksDirectory())
    const holder = await createLockRecord("memory-write")
    await acquireLock(lockPath, holder)
    const reads = countCalls("readFile", lockPath)

    // #when
    try {
      await expect(acquireLock(lockPath, await createLockRecord("memory-write"), { waitTimeoutMs: 1_000, retryDelayMs: 5 })).rejects.toBeInstanceOf(LockContentionError)

      // #then
      expect(reads.count()).toBeLessThanOrEqual(25)
    } finally {
      reads.restore()
      await releaseLock(lockPath, holder)
    }
  })

  test("#given every recall-wake slot held for a second #when a contender waits #then the queue is polled a bounded number of times", async () => {
    // #given
    const locksDirectory = await createLocksDirectory()
    const held = await acquireRecallWakeLease(locksDirectory, { maxConcurrent: 1 })
    const polls = countCalls("readdir", recallWakeTicketDirectory(locksDirectory))

    // #when
    try {
      await expect(acquireRecallWakeLease(locksDirectory, { maxConcurrent: 1, waitTimeoutMs: 1_000, retryDelayMs: 5 })).rejects.toBeInstanceOf(RecallWakeBusyError)

      // #then
      expect(polls.count()).toBeLessThanOrEqual(25)
    } finally {
      polls.restore()
      await held.release()
    }
  })
})

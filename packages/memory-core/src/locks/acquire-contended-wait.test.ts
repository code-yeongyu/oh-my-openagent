import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  LockContentionError,
  acquireLock,
  createLockRecord,
  memoryWriterLockPath,
  parseLockRecord,
  releaseLock,
  setLockCandidateFsForTests,
} from "./index"

const temporaryDirectories: string[] = []

async function createLocksDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "acquire-contended-wait-"))
  temporaryDirectories.push(directory)
  return directory
}

/**
 * Counts exclusive publish attempts. `publishExclusive` unlinks its candidate exactly once, in the
 * `finally` of every attempt, and the candidate filesystem seam is the only route to that unlink -
 * so one intercepted candidate unlink is one create+write+fsync+link cycle that reached the disk.
 */
function countPublishAttempts(): { readonly attempts: () => number; readonly restore: () => void } {
  let attempts = 0
  const restore = setLockCandidateFsForTests({
    unlink: async (candidatePath) => {
      attempts += 1
      await unlink(candidatePath).catch(() => {})
    },
  })
  return { attempts: () => attempts, restore }
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe("acquireLock contended wait", () => {
  test("#given a live holder #when a contender waits out its whole budget #then it never publishes a candidate", async () => {
    // #given
    const locksDirectory = await createLocksDirectory()
    const lockPath = memoryWriterLockPath(locksDirectory)
    const holder = await createLockRecord("memory-write", { runId: "holder" })
    await acquireLock(lockPath, holder)
    const publishes = countPublishAttempts()

    // #when
    const contender = await createLockRecord("memory-write", { runId: "contender" })
    const contended = acquireLock(lockPath, contender, { waitTimeoutMs: 120, retryDelayMs: 10 })

    // #then
    try {
      await expect(contended).rejects.toBeInstanceOf(LockContentionError)
      // A waiter that re-attempted the publish on every retry tick produced one fsynced
      // create/link/unlink cycle per tick against the volume the holder is writing to, which is
      // the load that starved the Windows two-process writer test (#8323). While the lock is
      // visibly held, the wait must cost reads only.
      expect(publishes.attempts()).toBe(0)
    } finally {
      publishes.restore()
      await releaseLock(lockPath, holder)
    }
  })

  test("#given a holder that releases mid-wait #when the contender is waiting #then it takes the lock without a contention error", async () => {
    // #given
    const locksDirectory = await createLocksDirectory()
    const lockPath = memoryWriterLockPath(locksDirectory)
    const holder = await createLockRecord("memory-write", { runId: "holder" })
    await acquireLock(lockPath, holder)
    const contender = await createLockRecord("memory-write", { runId: "contender" })

    // #when
    const contended = acquireLock(lockPath, contender, { waitTimeoutMs: 10_000, retryDelayMs: 5 })
    expect(await releaseLock(lockPath, holder)).toBe(true)
    await contended

    // #then
    expect(parseLockRecord(await readFile(lockPath, "utf8"))?.nonce).toBe(contender.nonce)
    await releaseLock(lockPath, contender)
  })
})

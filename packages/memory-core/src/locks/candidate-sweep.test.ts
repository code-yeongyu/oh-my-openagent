import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  CANDIDATE_STALE_AGE_MS,
  CANDIDATE_UNLINK_ATTEMPTS,
  sweepStaleLockCandidates,
} from "./candidate-sweep"
import { acquireLock, createLockRecord, releaseLock, setLockCandidateFsForTests } from "./index"

const temporaryDirectories: string[] = []

async function createLocksDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "candidate-sweep-"))
  temporaryDirectories.push(directory)
  return directory
}

async function writeAged(directory: string, name: string, ageMs: number): Promise<void> {
  const filePath = path.join(directory, name)
  await writeFile(filePath, "{}", "utf8")
  const agedSeconds = (Date.now() - ageMs) / 1000
  await utimes(filePath, agedSeconds, agedSeconds)
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe("sweepStaleLockCandidates", () => {
  test("#given stale and fresh candidates #when swept #then only stale candidates are deleted", async () => {
    const directory = await createLocksDirectory()
    const staleAge = CANDIDATE_STALE_AGE_MS * 2
    await writeAged(directory, "notice.lock", staleAge)
    await writeAged(directory, "notice.lock.recovery", staleAge)
    await writeAged(directory, "notice.lock.candidate-11111111-aaaa-bbbb-cccc-000000000001", 0)
    await writeAged(directory, "notice.lock.candidate-11111111-aaaa-bbbb-cccc-000000000002", staleAge)
    await writeAged(directory, "reflection-scheduler.lock.recovery.candidate-11111111-aaaa-bbbb-cccc-000000000003", staleAge)

    const swept = await sweepStaleLockCandidates(directory)

    expect(swept).toBe(2)
    expect((await readdir(directory)).sort()).toEqual([
      "notice.lock",
      "notice.lock.candidate-11111111-aaaa-bbbb-cccc-000000000001",
      "notice.lock.recovery",
    ])
  })

  test("#given a missing locks directory #when swept #then nothing is swept", async () => {
    const directory = await createLocksDirectory()
    await expect(sweepStaleLockCandidates(path.join(directory, "missing"))).resolves.toBe(0)
  })

  test("#given a legal lock name containing .candidate- #when swept #then the live lock survives", async () => {
    const directory = await createLocksDirectory()
    const staleAge = CANDIDATE_STALE_AGE_MS * 2
    // runFinalizationLockPath permits dots and hyphens in run ids, so this is a REAL lock
    // file name, not a leaked candidate; only UUID-suffixed candidates may ever be swept.
    await writeAged(directory, "finalize-run.candidate-live.lock", staleAge)
    await writeAged(directory, "finalize-run.candidate-live.lock.recovery", staleAge)

    const swept = await sweepStaleLockCandidates(directory)

    expect(swept).toBe(0)
    expect((await readdir(directory)).sort()).toEqual([
      "finalize-run.candidate-live.lock",
      "finalize-run.candidate-live.lock.recovery",
    ])
  })

  test("#given one sharing-failing candidate and one removable candidate #when stale candidates are swept #then the failure is bounded and the rest are reclaimed", async () => {
    const directory = await createLocksDirectory()
    const staleAge = CANDIDATE_STALE_AGE_MS * 2
    const blocked = "one.lock.candidate-11111111-aaaa-bbbb-cccc-000000000010"
    const removable = "two.lock.candidate-11111111-aaaa-bbbb-cccc-000000000011"
    await writeAged(directory, blocked, staleAge)
    await writeAged(directory, removable, staleAge)
    let blockedAttempts = 0
    const swept = await sweepStaleLockCandidates(directory, () => Date.now(), {
      isSharingError: () => true,
      onFailure: () => { throw new Error("advisory callback failure") },
      unlink: async (candidatePath) => {
        if (candidatePath.endsWith(blocked)) {
          blockedAttempts += 1
          const error = new Error("sharing") as NodeJS.ErrnoException
          error.code = "EPERM"
          throw error
        }
        await rm(candidatePath)
      },
    })

    expect(blockedAttempts).toBe(CANDIDATE_UNLINK_ATTEMPTS)
    expect(swept).toBe(1)
    expect((await readdir(directory)).sort()).toEqual([blocked])
  })

  test("#given persistent sharing failure #when the next lock is acquired #then fresh candidate cleanup is not retried and aged candidates remain reclaimable", async () => {
    const directory = await createLocksDirectory()
    const lockPath = path.join(directory, "resource.lock")
    const attemptsByPath = new Map<string, number>()
    const restore = setLockCandidateFsForTests({
      isSharingError: () => true,
      unlink: async (candidatePath) => {
        attemptsByPath.set(candidatePath, (attemptsByPath.get(candidatePath) ?? 0) + 1)
        const error = new Error("sharing") as NodeJS.ErrnoException
        error.code = "EPERM"
        throw error
      },
    })
    try {
      const first = await createLockRecord("memory-write", {})
      await acquireLock(lockPath, first)
      await releaseLock(lockPath, first)
      const firstCandidate = (await readdir(directory)).find((name) => name.includes(".candidate-"))
      expect(firstCandidate).toBeDefined()

      const second = await createLockRecord("memory-write", {})
      await acquireLock(lockPath, second)
      await releaseLock(lockPath, second)
      expect(attemptsByPath.get(path.join(directory, firstCandidate!))).toBe(CANDIDATE_UNLINK_ATTEMPTS)
    } finally {
      restore()
    }

    const leakedCandidates = (await readdir(directory)).filter((name) => name.includes(".candidate-"))
    for (const name of leakedCandidates) await utimes(path.join(directory, name), 0, 0)
    expect(await sweepStaleLockCandidates(directory)).toBe(leakedCandidates.length)
    expect((await readdir(directory)).filter((name) => name.includes(".candidate-"))).toEqual([])
  })

  test("#given a stale candidate #when the first lock in that directory is acquired #then the candidate is swept", async () => {
    const directory = await createLocksDirectory()
    const staleName = "other.lock.candidate-11111111-aaaa-bbbb-cccc-000000000009"
    await writeAged(directory, staleName, CANDIDATE_STALE_AGE_MS * 2)

    const record = await createLockRecord("memory-write", {})
    const lockPath = path.join(directory, "resource.lock")
    await acquireLock(lockPath, record)
    await releaseLock(lockPath, record)

    expect((await readdir(directory)).includes(staleName)).toBe(false)
  })
})

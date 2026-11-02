import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, readdir, rm, unlink, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import * as resilientFs from "../fs/resilient"
import { sweepStaleLockCandidates } from "./candidate-sweep"
import { LOCK_DIRECTORY_SWEEP_INTERVAL_MS } from "./acquire"
import { sweepDeadOwnerLocks } from "./dead-owner-sweep"
import {
  LockContentionError,
  acquireLock,
  createLockRecord,
  memoryWriterLockPath,
  noticeLockPath,
  receiptsLockPath,
  releaseLock,
  setLockCandidateFsForTests,
} from "./index"
import type { LockRecord } from "./lock-record"

const temporaryDirectories: string[] = []

async function createLocksDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "dead-owner-reclaim-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true })
})

/** A pid the kernel no longer knows: a child that has already exited and been reaped. */
function exitedPid(): number {
  const child = Bun.spawnSync([process.execPath, "-e", ""])
  if (child.exitCode !== 0 || child.pid === undefined) throw new Error("could not spawn a short-lived child")
  return child.pid
}

async function deadOwnerRecord(purpose: string): Promise<LockRecord> {
  return { ...(await createLockRecord(purpose)), pid: exitedPid(), process_start: "unavailable" }
}

async function writeRecord(lockPath: string, record: LockRecord): Promise<void> {
  await writeFile(lockPath, `${JSON.stringify(record)}\n`, { mode: 0o600 })
}

function countPublishAttempts(): { readonly names: () => readonly string[]; readonly restore: () => void } {
  const names: string[] = []
  const restore = setLockCandidateFsForTests({
    unlink: async (candidatePath) => {
      names.push(path.basename(candidatePath))
      await unlink(candidatePath).catch(() => {})
    },
  })
  return { names: () => names, restore }
}

describe("dead-owner lock reclaim", () => {
  test("#given a dead primary owner and a live recovery holder #when six contenders wait #then none publishes a candidate", async () => {
    // #given
    const lockPath = memoryWriterLockPath(await createLocksDirectory())
    await writeRecord(lockPath, await deadOwnerRecord("memory-write"))
    const recoveryHolder = await createLockRecord("memory-write:recovery")
    await writeRecord(`${lockPath}.recovery`, recoveryHolder)
    const publishes = countPublishAttempts()

    // #when
    try {
      const contenders = await Promise.allSettled(
        Array.from({ length: 6 }, async (_, index) =>
          acquireLock(lockPath, await createLockRecord("memory-write", { runId: `c${index}` }), { waitTimeoutMs: 300, retryDelayMs: 10 }),
        ),
      )

      // #then
      // Every tick used to run create+write+fsync+link+unlink on the recovery path while a live
      // owner visibly held it: about 40 publishes per second per waiter.
      expect(contenders.every((result) => result.status === "rejected" && result.reason instanceof LockContentionError)).toBe(true)
      expect(publishes.names()).toEqual([])
    } finally {
      publishes.restore()
    }
  })

  test("#given locks left by crashed and live owners #when the directory is swept #then only proven-dead owners are reclaimed", async () => {
    // #given
    const locksDirectory = await createLocksDirectory()
    const crashed = receiptsLockPath(locksDirectory)
    const crashedWithRecovery = noticeLockPath(locksDirectory)
    const live = memoryWriterLockPath(locksDirectory)
    const unparsable = path.join(locksDirectory, "half-written.lock")
    await writeRecord(crashed, await deadOwnerRecord("receipts"))
    await writeRecord(crashedWithRecovery, await deadOwnerRecord("notice"))
    await writeRecord(`${crashedWithRecovery}.recovery`, await deadOwnerRecord("notice:recovery"))
    const liveOwner = await createLockRecord("memory-write")
    await writeRecord(live, liveOwner)
    await writeFile(unparsable, "{\"pid\":", { mode: 0o600 })

    // #when
    const reclaimed = await sweepDeadOwnerLocks(locksDirectory)

    // #then
    expect(reclaimed).toBe(2)
    expect((await readdir(locksDirectory)).sort()).toEqual([path.basename(unparsable), path.basename(live)].sort())
    await releaseLock(live, liveOwner)
  })

  test("#given a crashed owner's lock #when the process first takes any lock in that directory #then the dead lock is gone", async () => {
    // #given
    const locksDirectory = await createLocksDirectory()
    const crashed = receiptsLockPath(locksDirectory)
    await writeRecord(crashed, await deadOwnerRecord("receipts"))

    // #when
    const holder = await createLockRecord("memory-write")
    await acquireLock(memoryWriterLockPath(locksDirectory), holder)

    // #then
    expect(await readdir(locksDirectory)).toEqual([path.basename(memoryWriterLockPath(locksDirectory))])
    await releaseLock(memoryWriterLockPath(locksDirectory), holder)
  })

  test("#given a process that already swept a directory #when a crashed owner leaves a lock later #then the next sweep after the interval reclaims it", async () => {
    // #given
    const locksDirectory = await createLocksDirectory()
    const writer = memoryWriterLockPath(locksDirectory)
    const crashed = receiptsLockPath(locksDirectory)
    const start = Date.now()
    const holder = await createLockRecord("memory-write")
    await acquireLock(writer, holder, { now: () => start })
    await releaseLock(writer, holder)
    await writeRecord(crashed, await deadOwnerRecord("receipts"))

    // #when
    await acquireLock(writer, holder, { now: () => start + 60_000 })
    await releaseLock(writer, holder)
    const beforeInterval = await readdir(locksDirectory)
    await acquireLock(writer, holder, { now: () => start + LOCK_DIRECTORY_SWEEP_INTERVAL_MS })
    await releaseLock(writer, holder)

    // #then
    expect(beforeInterval).toEqual([path.basename(crashed)])
    expect(await readdir(locksDirectory)).toEqual([])
  })

  test("#given an unreadable lock before a crashed owner's lock #when the directory is swept #then the dead lock is still reclaimed and the failure is reported", async () => {
    // #given
    const locksDirectory = await createLocksDirectory()
    const unreadable = path.join(locksDirectory, "a-unreadable.lock")
    const crashed = path.join(locksDirectory, "b-crashed.lock")
    await writeRecord(unreadable, await deadOwnerRecord("unreadable"))
    await writeRecord(crashed, await deadOwnerRecord("crashed"))
    const realReadFile = resilientFs.readFile
    const readFailure = spyOn(resilientFs, "readFile").mockImplementation(((filePath: string, ...rest: unknown[]) => {
      if (String(filePath) === unreadable) return Promise.reject(Object.assign(new Error("permission denied"), { code: "EACCES" }))
      return (realReadFile as (...args: unknown[]) => unknown)(filePath, ...rest)
    }) as typeof resilientFs.readFile)
    const failures: string[] = []

    // #when
    let reclaimed: number
    try {
      reclaimed = await sweepDeadOwnerLocks(locksDirectory, { onFailure: (lockPath) => failures.push(path.basename(lockPath)) })
    } finally {
      readFailure.mockRestore()
    }

    // #then
    expect(reclaimed).toBe(1)
    expect(failures).toEqual([path.basename(unreadable)])
    expect(await readdir(locksDirectory)).toEqual([path.basename(unreadable)])
  })

  test("#given leaked candidates #when swept #then a dead process's candidate goes at once and a live one's young candidate stays", async () => {
    // #given
    const locksDirectory = await createLocksDirectory()
    const lockPath = receiptsLockPath(locksDirectory)
    const dead = `${lockPath}.candidate-${exitedPid()}-${randomUUID()}`
    const live = `${lockPath}.candidate-${process.pid}-${randomUUID()}`
    const legacy = `${lockPath}.candidate-${randomUUID()}`
    const legacyOld = `${lockPath}.candidate-${randomUUID()}`
    for (const candidate of [dead, live, legacy, legacyOld]) await writeFile(candidate, "{}\n")
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await utimes(legacyOld, twoHoursAgo, twoHoursAgo)

    // #when
    const swept = await sweepStaleLockCandidates(locksDirectory)

    // #then
    expect(swept).toBe(2)
    expect((await readdir(locksDirectory)).sort()).toEqual([path.basename(legacy), path.basename(live)].sort())
  })

  test("#given a publish #when it creates its candidate #then the candidate name carries this process's pid", async () => {
    // #given
    const lockPath = receiptsLockPath(await createLocksDirectory())
    const publishes = countPublishAttempts()
    const holder = await createLockRecord("receipts")

    // #when
    try {
      await acquireLock(lockPath, holder)
    } finally {
      publishes.restore()
    }

    // #then
    expect(publishes.names()).toHaveLength(1)
    expect(publishes.names()[0]).toStartWith(`${path.basename(lockPath)}.candidate-${process.pid}-`)
    await releaseLock(lockPath, holder)
  })
})

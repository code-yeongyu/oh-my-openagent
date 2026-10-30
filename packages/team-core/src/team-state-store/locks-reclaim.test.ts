import { expect, test } from "bun:test"
import type { PathLike } from "node:fs"
import { readdir, readFile, rm, unlink, utimes, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { createTempDirectory, startLockHolder } from "./lock-test-support"

function createErrnoError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

async function writeCrashTornLock(lockPath: string): Promise<void> {
  await writeFile(lockPath, "")
  const crashedAt = new Date(Date.now() - 3_600_000)
  await utimes(lockPath, crashedAt, crashedAt)
}

test("#given concurrent reclaimers of one crash-torn lock #when they all reclaim it #then exactly one removes it", async () => {
  // given
  const { removeLockRecordIfUnchanged } = await import("./lock-reclaim")
  const rootDirectory = await createTempDirectory("locks-reclaim-once-")
  const lockPath = join(rootDirectory, "lock")
  await writeCrashTornLock(lockPath)

  // when
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => removeLockRecordIfUnchanged(lockPath, "", 300_000)))

  // then
  expect(outcomes.filter((outcome) => outcome === "removed")).toHaveLength(1)
  expect(await readdir(rootDirectory)).toEqual([])
  await rm(rootDirectory, { recursive: true, force: true })
})

test("#given a second reclaimer and a new holder racing into the gap before the unlink #when the first reclaimer unlinks #then the new holder keeps the lock", async () => {
  // given
  const { removeLockRecordIfUnchanged } = await import("./lock-reclaim")
  const rootDirectory = await createTempDirectory("locks-reclaim-gap-")
  const lockPath = join(rootDirectory, "lock")
  await writeCrashTornLock(lockPath)
  const liveRecord = `racer\n${process.ppid}\n${Date.now()}\n00000000-0000-4000-8000-000000000005\n`
  let racerOutcome: string | undefined
  let racerPublished = false

  // when
  const outcome = await removeLockRecordIfUnchanged(lockPath, "", 300_000, {
    unlink: async (path: PathLike) => {
      if (String(path) === lockPath && racerOutcome === undefined) {
        racerOutcome = await removeLockRecordIfUnchanged(lockPath, "", 300_000)
        racerPublished = await writeFile(lockPath, liveRecord, { flag: "wx" }).then(() => true, () => false)
      }
      await unlink(path)
    },
  })

  // then
  expect(racerOutcome).toBe("busy")
  expect(racerPublished).toBe(false)
  expect(outcome).toBe("removed")
  expect(await readdir(rootDirectory)).toEqual([])
  await rm(rootDirectory, { recursive: true, force: true })
})

test("#given a reclaimer that observed a torn lock before another process took the path #when it reclaims #then the new holder keeps the lock", async () => {
  // given
  const { removeLockRecordIfUnchanged } = await import("./lock-reclaim")
  const rootDirectory = await createTempDirectory("locks-reclaim-late-")
  const lockPath = join(rootDirectory, "lock")
  await writeCrashTornLock(lockPath)
  expect(await removeLockRecordIfUnchanged(lockPath, "", 300_000)).toBe("removed")
  const holder = await startLockHolder(rootDirectory, lockPath)
  const heldRecord = await readFile(lockPath, "utf8")

  // when
  const lateOutcome = await removeLockRecordIfUnchanged(lockPath, "", 300_000)

  // then
  expect(lateOutcome).toBe("changed")
  expect(await readFile(lockPath, "utf8")).toBe(heldRecord)
  expect(await holder.release()).toBe(0)
  await rm(rootDirectory, { recursive: true, force: true })
}, 30_000)

test("#given a lock this process left behind after a failed release #when withLock runs #then it reclaims the leftover and acquires", async () => {
  // given
  const { detectStaleLock, lockOwnerInstanceId, withLock } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-reclaim-own-leftover-")
  const lockPath = join(rootDirectory, "lock")
  await writeFile(lockPath, `owner ${crypto.randomUUID()}\n${process.pid}\n${Date.now()}\n${lockOwnerInstanceId}\n`)

  // when
  const staleDetected = await detectStaleLock(lockPath, 300_000)
  const result = await withLock(lockPath, async () => "acquired")

  // then
  expect(staleDetected).toBe(true)
  expect(result).toBe("acquired")
  expect(await readdir(rootDirectory)).toEqual([])
  await rm(rootDirectory, { recursive: true, force: true })
})

test("#given this process's leftover lock was replaced by another process #when this process reclaims its old record #then the other holder keeps the lock", async () => {
  // given
  const { removeLockRecordIfUnchanged } = await import("./lock-reclaim")
  const { lockOwnerInstanceId } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-reclaim-own-replaced-")
  const lockPath = join(rootDirectory, "lock")
  const leftover = `owner ${crypto.randomUUID()}\n${process.pid}\n${Date.now()}\n${lockOwnerInstanceId}\n`
  await writeFile(lockPath, leftover)
  await unlink(lockPath)
  const holder = await startLockHolder(rootDirectory, lockPath)
  const heldRecord = await readFile(lockPath, "utf8")

  // when
  const outcome = await removeLockRecordIfUnchanged(lockPath, leftover, 300_000)

  // then
  expect(outcome).toBe("changed")
  expect(await readFile(lockPath, "utf8")).toBe(heldRecord)
  expect(await holder.release()).toBe(0)
  await rm(rootDirectory, { recursive: true, force: true })
}, 30_000)

test("#given another process took the path while this process held it #when this process releases #then the other holder keeps the lock", async () => {
  // given
  const { withLock } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-reclaim-release-")
  const lockPath = join(rootDirectory, "lock")
  let holder: Awaited<ReturnType<typeof startLockHolder>> | undefined

  // when
  await withLock(lockPath, async () => {
    await unlink(lockPath)
    holder = await startLockHolder(rootDirectory, lockPath)
  })

  // then
  if (holder === undefined) throw new Error("holder did not start")
  expect(await readFile(lockPath, "utf8")).toContain(`\n${holder.pid}\n`)
  expect(await holder.release()).toBe(0)
  await rm(rootDirectory, { recursive: true, force: true })
}, 30_000)

test("#given a stale lock whose unlink hits transient EPERM #when it is reaped #then the unlink is retried until the lock is gone", async () => {
  // given
  const { reapStaleLock } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-reclaim-eperm-")
  const lockPath = join(rootDirectory, "lock")
  await writeFile(lockPath, `owner\n999999999\n${Date.now()}\n00000000-0000-4000-8000-000000000004\n`)
  const delayCalls: number[] = []
  let lockUnlinkCalls = 0

  // when
  const outcome = await reapStaleLock(lockPath, 300_000, {
    delay: async (ms: number) => {
      delayCalls.push(ms)
    },
    unlink: async (path: PathLike) => {
      if (String(path) === lockPath) {
        lockUnlinkCalls += 1
        if (lockUnlinkCalls < 3) throw createErrnoError("EPERM")
      }
      await unlink(path)
    },
  })

  // then
  expect(outcome).toBe("removed")
  expect(lockUnlinkCalls).toBe(3)
  expect(delayCalls).toEqual([25, 25])
  expect(await readdir(rootDirectory)).toEqual([])
  await rm(rootDirectory, { recursive: true, force: true })
})

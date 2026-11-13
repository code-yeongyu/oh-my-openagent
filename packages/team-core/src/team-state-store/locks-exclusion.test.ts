import { expect, test } from "bun:test"
import { readFile, rm, utimes, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { createTempDirectory, runLockContenders, startLockHolder } from "./lock-test-support"

function overlappingEntries(log: string): string[] {
  const violations: string[] = []
  let holder: string | null = null
  for (const line of log.split("\n").filter((entry) => entry.length > 0)) {
    const [event, pid] = line.split(" ")
    if (event === "enter") {
      if (holder !== null) violations.push(`${pid} entered while ${holder} held the lock`)
      holder = pid ?? null
    } else {
      if (holder !== pid) violations.push(`${pid} exited while ${holder} held the lock`)
      holder = null
    }
  }
  return violations
}

test("#given processes racing to reclaim a crash-torn lock #when each enters the lock repeatedly #then no two ever hold it at once", async () => {
  // given
  const rootDirectory = await createTempDirectory("locks-exclusion-torn-")
  const lockPath = join(rootDirectory, "lock")
  const logPath = join(rootDirectory, "holders.log")
  await writeFile(lockPath, "")
  const crashedAt = new Date(Date.now() - 3_600_000)
  await utimes(lockPath, crashedAt, crashedAt)

  // when
  const exitCodes = await runLockContenders(rootDirectory, lockPath, logPath, 4, 25)

  // then
  expect(exitCodes).toEqual([0, 0, 0, 0])
  const log = await readFile(logPath, "utf8")
  expect(overlappingEntries(log)).toEqual([])
  expect(log.split("\n").filter((line) => line.startsWith("enter ")).length).toBe(100)
  await expect(readFile(lockPath, "utf8")).rejects.toThrow()
  await rm(rootDirectory, { recursive: true, force: true })
}, 60_000)

test("#given a live holder whose record is older than the stale window #when another process checks and reaps it #then the lock is kept", async () => {
  // given
  const { detectStaleLock, reapStaleLock } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-exclusion-slow-")
  const lockPath = join(rootDirectory, "lock")
  const holder = await startLockHolder(rootDirectory, lockPath, 1)
  const heldRecord = await readFile(lockPath, "utf8")
  const longAgo = new Date(Date.now() - 3_600_000)
  await utimes(lockPath, longAgo, longAgo)

  // when
  const staleDetected = await detectStaleLock(lockPath, 1)
  const reapOutcome = await reapStaleLock(lockPath, 1)

  // then
  expect(staleDetected).toBe(false)
  expect(reapOutcome).toBe("changed")
  expect(await readFile(lockPath, "utf8")).toBe(heldRecord)
  expect(await holder.release()).toBe(0)
  await expect(readFile(lockPath, "utf8")).rejects.toThrow()
  await rm(rootDirectory, { recursive: true, force: true })
}, 30_000)

test("#given a legacy 3-line record from a live pid acquired long ago #when detectStaleLock runs with a tiny window #then it is not stale", async () => {
  // given
  const { detectStaleLock } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-exclusion-legacy-slow-")
  const lockPath = join(rootDirectory, "lock")
  await writeFile(lockPath, `legacy-live\n${process.pid}\n${Date.now() - 3_600_000}\n`)

  // when
  const staleDetected = await detectStaleLock(lockPath, 1)

  // then
  expect(staleDetected).toBe(false)
  await rm(rootDirectory, { recursive: true, force: true })
})

test("#given a torn lock #when detectStaleLock runs #then only a torn file older than the stale window is stale", async () => {
  // given
  const { detectStaleLock } = await import("./locks")
  const rootDirectory = await createTempDirectory("locks-exclusion-torn-age-")
  const freshPath = join(rootDirectory, "fresh.lock")
  const oldPath = join(rootDirectory, "old.lock")
  await writeFile(freshPath, "")
  await writeFile(oldPath, "owner\n")
  const crashedAt = new Date(Date.now() - 3_600_000)
  await utimes(oldPath, crashedAt, crashedAt)

  // when
  const freshStale = await detectStaleLock(freshPath, 300_000)
  const oldStale = await detectStaleLock(oldPath, 300_000)

  // then
  expect(freshStale).toBe(false)
  expect(oldStale).toBe(true)
  await rm(rootDirectory, { recursive: true, force: true })
})

import { expect, test } from "bun:test"
import { appendFile, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { publishLockRecord } from "./lock-publish"
import { createTempDirectory, runLockContenders } from "./lock-test-support"
import { detectStaleLock, LockLeaseLostError, reapStaleLock, withLock } from "./locks"

const spawnChild = () => Bun.spawn(["cat"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })

test("#given a held lock #when it is handed to a live child and restored #then the record names the child, then the original bytes come back", async () => {
  // given
  const root = await createTempDirectory("lock-lease-roundtrip-")
  const lockPath = join(root, "lock")
  const child = spawnChild()

  // when
  const observed = await withLock(lockPath, async (lease) => {
    const original = await readFile(lockPath, "utf8")
    await lease.handOver(child.pid)
    const handed = await readFile(lockPath, "utf8")
    await lease.restore()
    return { original, handed, restored: await readFile(lockPath, "utf8") }
  }, { staleAfterMs: Number.POSITIVE_INFINITY })

  // then
  const lines = observed.handed.split("\n").filter((line) => line.length > 0)
  expect(lines).toHaveLength(4)
  expect(lines[1]).toBe(String(child.pid))
  expect(lines[3]).not.toBe(observed.original.split("\n")[3])
  expect(observed.restored).toBe(observed.original)
  await expect(readFile(lockPath, "utf8")).rejects.toThrow()
  child.stdin.end()
  await child.exited
  await rm(root, { recursive: true, force: true })
})

test("#given a lock handed to a live child #when anyone tries to take or reap it #then it stays held, and contenders enter only after release", async () => {
  // given
  const root = await createTempDirectory("lock-lease-exclusion-")
  const lockPath = join(root, "lock")
  const logPath = join(root, "holders.log")
  await writeFile(logPath, "")
  const child = spawnChild()
  let contenders: Promise<number[]> = Promise.resolve([])

  // when
  const during = await withLock(lockPath, async (lease) => {
    contenders = runLockContenders(root, lockPath, logPath, 2, 3).then((codes) => codes.map((code) => code ?? -1))
    await lease.handOver(child.pid)
    await appendFile(logPath, "handover\n")
    const checks = {
      stale: await detectStaleLock(lockPath, 0),
      reaped: await reapStaleLock(lockPath, 0),
      published: await publishLockRecord(lockPath, `contender ${crypto.randomUUID()}\n${process.pid}\n${Date.now()}\nx\n`),
    }
    await lease.restore()
    await appendFile(logPath, "release\n")
    return checks
  }, { staleAfterMs: Number.POSITIVE_INFINITY })

  // then
  expect(during).toEqual({ stale: false, reaped: "changed", published: false })
  expect(await contenders).toEqual([0, 0])
  const log = (await readFile(logPath, "utf8")).split("\n").filter((line) => line.length > 0)
  const released = log.indexOf("release")
  expect(log.indexOf("handover")).toBeLessThan(released)
  expect(log.slice(0, released).some((line) => line.startsWith("enter "))).toBe(false)
  child.stdin.end()
  await child.exited
  await rm(root, { recursive: true, force: true })
}, 60_000)

test("#given a lock handed to a child #when the record changes before restore #then restore aborts with LockLeaseLostError and the other record is kept", async () => {
  // given
  const root = await createTempDirectory("lock-lease-lost-")
  const lockPath = join(root, "lock")
  const child = spawnChild()
  const foreign = `other ${crypto.randomUUID()}\n${child.pid}\n${Date.now()}\n${crypto.randomUUID()}\n`

  // when
  const outcome = withLock(lockPath, async (lease) => {
    await lease.handOver(child.pid)
    await writeFile(lockPath, foreign)
    await lease.restore()
  }, { staleAfterMs: Number.POSITIVE_INFINITY })

  // then
  await expect(outcome).rejects.toBeInstanceOf(LockLeaseLostError)
  expect(await readFile(lockPath, "utf8")).toBe(foreign)
  child.stdin.end()
  await child.exited
  await rm(root, { recursive: true, force: true })
})

test("#given a client that never restores #when its child is still alive and then exits #then the record goes stale only after the child exits", async () => {
  // given
  const root = await createTempDirectory("lock-lease-orphan-")
  const lockPath = join(root, "lock")
  const child = spawnChild()

  // when
  await withLock(lockPath, async (lease) => {
    await lease.handOver(child.pid)
  }, { staleAfterMs: Number.POSITIVE_INFINITY })
  const whileAlive = await detectStaleLock(lockPath, Number.POSITIVE_INFINITY)
  child.stdin.end()
  await child.exited
  const afterExit = await detectStaleLock(lockPath, Number.POSITIVE_INFINITY)

  // then
  expect(whileAlive).toBe(false)
  expect(afterExit).toBe(true)
  expect(await reapStaleLock(lockPath, Number.POSITIVE_INFINITY)).toBe("removed")
  await rm(root, { recursive: true, force: true })
})

test("#given a held lock #when handOver runs twice or restore runs without a handover #then both are refused", async () => {
  // given
  const root = await createTempDirectory("lock-lease-misuse-")
  const lockPath = join(root, "lock")
  const child = spawnChild()

  // when / then
  await withLock(lockPath, async (lease) => {
    await expect(lease.restore()).rejects.toThrow("not handed over")
    await lease.handOver(child.pid)
    await expect(lease.handOver(child.pid)).rejects.toThrow("already handed over")
    await lease.restore()
  })
  child.stdin.end()
  await child.exited
  await rm(root, { recursive: true, force: true })
})

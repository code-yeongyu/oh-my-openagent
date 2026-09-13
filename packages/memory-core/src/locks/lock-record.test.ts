import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  LockContentionError,
  acquireLock,
  createLockRecord,
  getProcessStartIdentity,
  isHeld,
  releaseLock,
  withLock,
} from "./index"

const temporaryDirectories: string[] = []

async function createLockPath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "memory-lock-unit-"))
  temporaryDirectories.push(directory)
  return path.join(directory, "resource.lock")
}

// Start identities are only comparable inside one scheme, so a reused-pid fixture has to keep the
// platform's own scheme and differ only in the value; a foreign scheme is deliberately unstealable.
async function differentStartInSameScheme(): Promise<string> {
  const liveIdentity = await getProcessStartIdentity(process.pid)
  if (liveIdentity === null) return "different-process-start"
  return `${liveIdentity.slice(0, liveIdentity.indexOf(":") + 1)}1`
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    return null
  } catch (error) {
    return error
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }))
})

describe("cross-process lock protocol", () => {
  test("#given an absent lock #when it is acquired and released #then the complete record is published and removed", async () => {
    // #given
    const lockPath = await createLockPath()
    const record = await createLockRecord("memory-write", { runId: "run-1" })

    // #when
    await acquireLock(lockPath, record)
    const published = JSON.parse(await readFile(lockPath, "utf8"))

    // #then
    expect(published).toEqual(record)
    expect(await isHeld(lockPath)).toBe(true)
    expect(await releaseLock(lockPath, record)).toBe(true)
    expect(await isHeld(lockPath)).toBe(false)
  })

  test("#given an owned lock #when another owner acquires it #then a typed retriable contention error is raised", async () => {
    // #given
    const lockPath = await createLockPath()
    const owner = await createLockRecord("memory-write")
    await acquireLock(lockPath, owner)

    // #when
    const contender = await createLockRecord("memory-write")
    const error = await captureError(acquireLock(lockPath, contender))

    // #then
    expect(error).toBeInstanceOf(LockContentionError)
    expect(error).toMatchObject({ retriable: true, lockPath })
    await releaseLock(lockPath, owner)
  })

  test("#given a lock whose nonce changed #when the former owner releases #then the replacement remains held", async () => {
    // #given
    const lockPath = await createLockPath()
    const formerOwner = await createLockRecord("memory-write")
    const replacement = await createLockRecord("memory-write")
    await writeFile(lockPath, `${JSON.stringify(replacement)}\n`)

    // #when
    const released = await releaseLock(lockPath, formerOwner)

    // #then
    expect(released).toBe(false)
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(replacement)
  })

  test("#given a live PID with a different process start #when acquisition is attempted #then PID reuse is recovered", async () => {
    // #given
    const lockPath = await createLockPath()
    const reusedPidOwner = {
      ...(await createLockRecord("memory-write")),
      process_start: await differentStartInSameScheme(),
    }
    await writeFile(lockPath, `${JSON.stringify(reusedPidOwner)}\n`)

    // #when
    const successor = await createLockRecord("memory-write")
    await acquireLock(lockPath, successor)

    // #then
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(successor)
    await releaseLock(lockPath, successor)
  })

  test("#given a very old lock whose owner is live #when acquisition is attempted #then age alone never permits recovery", async () => {
    // #given
    const lockPath = await createLockPath()
    const liveOwner = {
      ...(await createLockRecord("memory-write")),
      created_at: "2000-01-01T00:00:00.000Z",
    }
    await writeFile(lockPath, `${JSON.stringify(liveOwner)}\n`)

    // #when
    const contender = await createLockRecord("memory-write")
    const error = await captureError(acquireLock(lockPath, contender))

    // #then
    expect(error).toBeInstanceOf(LockContentionError)
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(liveOwner)
  })

  test("#given a dead owner on another host #when acquisition is attempted #then recovery fails closed", async () => {
    // #given
    const lockPath = await createLockPath()
    const owner = {
      ...(await createLockRecord("reflection-scheduler")),
      pid: 2_000_000_000,
      hostname: "foreign-host.invalid",
    }
    await writeFile(lockPath, `${JSON.stringify(owner)}\n`)

    // #when
    const contender = await createLockRecord("reflection-scheduler")
    const error = await captureError(acquireLock(lockPath, contender))

    // #then
    expect(error).toBeInstanceOf(LockContentionError)
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(owner)
  })

  test("#given a dead primary owner and a dead recovery-lock owner #when a contender acquires #then both stale files are reclaimed without manual deletion", async () => {
    // #given
    const lockPath = await createLockPath()
    const recoveryPath = `${lockPath}.recovery`
    const deadOwner = { ...(await createLockRecord("reflection-scheduler")), pid: 2_000_000_000 }
    const deadRecoverer = { ...(await createLockRecord("reflection-scheduler:recovery")), pid: 1_999_999_999 }
    await writeFile(lockPath, `${JSON.stringify(deadOwner)}\n`)
    await writeFile(recoveryPath, `${JSON.stringify(deadRecoverer)}\n`)

    // #when — bind-time shape: a single pass must recover, no retries available
    const contender = await createLockRecord("reflection-scheduler")
    await acquireLock(lockPath, contender, { waitTimeoutMs: 0 })

    // #then
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(contender)
    expect(await isHeld(recoveryPath)).toBe(false)
    await releaseLock(lockPath, contender)
  })

  test("#given a dead primary owner and a LIVE recovery-lock owner #when a contender acquires #then the recovery holder is never displaced and contention is raised", async () => {
    // #given — this process is the live recoverer
    const lockPath = await createLockPath()
    const recoveryPath = `${lockPath}.recovery`
    const deadOwner = { ...(await createLockRecord("reflection-scheduler")), pid: 2_000_000_000 }
    const liveRecoverer = await createLockRecord("reflection-scheduler:recovery")
    await writeFile(lockPath, `${JSON.stringify(deadOwner)}\n`)
    await writeFile(recoveryPath, `${JSON.stringify(liveRecoverer)}\n`)

    // #when
    const contender = await createLockRecord("reflection-scheduler")
    const error = await captureError(acquireLock(lockPath, contender, { waitTimeoutMs: 200, retryDelayMs: 10 }))

    // #then
    expect(error).toBeInstanceOf(LockContentionError)
    expect(JSON.parse(await readFile(recoveryPath, "utf8"))).toEqual(liveRecoverer)
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(deadOwner)
  })

  test("#given a dead recovery-lock owner on another host #when a contender acquires #then the recovery lock is not reclaimed", async () => {
    // #given
    const lockPath = await createLockPath()
    const recoveryPath = `${lockPath}.recovery`
    const deadOwner = { ...(await createLockRecord("reflection-scheduler")), pid: 2_000_000_000 }
    const foreignRecoverer = {
      ...(await createLockRecord("reflection-scheduler:recovery")),
      pid: 1_999_999_999,
      hostname: "foreign-host.invalid",
    }
    await writeFile(lockPath, `${JSON.stringify(deadOwner)}\n`)
    await writeFile(recoveryPath, `${JSON.stringify(foreignRecoverer)}\n`)

    // #when
    const contender = await createLockRecord("reflection-scheduler")
    const error = await captureError(acquireLock(lockPath, contender, { waitTimeoutMs: 200, retryDelayMs: 10 }))

    // #then
    expect(error).toBeInstanceOf(LockContentionError)
    expect(JSON.parse(await readFile(recoveryPath, "utf8"))).toEqual(foreignRecoverer)
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(deadOwner)
  })

  test("#given a callback under a lock #when the callback fails #then withLock releases only its own lock", async () => {
    // #given
    const lockPath = await createLockPath()
    const record = await createLockRecord("transcript-state")

    // #when
    const error = await captureError(withLock(lockPath, record, async () => {
      throw new Error("callback failed")
    }))

    // #then
    expect(String(error)).toContain("callback failed")
    expect(await isHeld(lockPath)).toBe(false)
  })
})

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  LockContentionError,
  acquireLock,
  createLockRecord,
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
      process_start: "different-process-start",
    }
    await writeFile(lockPath, `${JSON.stringify(reusedPidOwner)}\n`)

    // #when
    const successor = await createLockRecord("memory-write")
    if (process.platform === "win32") {
      // getProcessStartIdentity has no Windows probe, so the live owner cannot be disproven;
      // recovery must fail closed instead of stealing the lock.
      const error = await captureError(acquireLock(lockPath, successor))
      expect(error).toBeInstanceOf(LockContentionError)
      expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(reusedPidOwner)
      return
    }
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

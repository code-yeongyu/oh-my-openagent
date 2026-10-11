import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, stat, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  LockContentionError,
  acquireLock,
  createLockRecord,
  getProcessStartIdentity,
  isHeld,
  releaseLock,
  setLockCandidateFsForTests,
  withLock,
} from "./index"
import { removeTree } from "../../../../test-support/remove-tree"

const temporaryDirectories: string[] = []
const restoreLockFs: Array<() => void> = []

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
  for (const restore of restoreLockFs.splice(0).reverse()) restore()
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await removeTree(directory, { maxRetries: 10, retryDelay: 200 })
  }))
})

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

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

  test("#given a link-published lock truncated by a power loss #when two contenders arrive after the incomplete grace #then one reclaims it and the other sees the new owner", async () => {
    // #given: normal link publication, followed by the empty durable state a power loss can leave
    const lockPath = await createLockPath()
    const original = await createLockRecord("memory-write")
    await acquireLock(lockPath, original)
    await writeFile(lockPath, "")
    const modifiedAt = (await stat(lockPath)).mtimeMs
    let now = modifiedAt
    const options = { incompleteLockGraceMs: 100, now: () => now }

    // #when: the empty file is still inside its grace period
    const early = await captureError(acquireLock(lockPath, await createLockRecord("memory-write"), options))

    // #then: it is held, never stolen while a writer could still be completing it
    expect(early).toBeInstanceOf(LockContentionError)
    expect(await readFile(lockPath, "utf8")).toBe("")

    // #when: after the injected clock passes the grace period, two contenders race the reclaim
    now += 101
    const contenders = await Promise.allSettled([
      acquireLock(lockPath, await createLockRecord("memory-write", { runId: "first" }), options),
      acquireLock(lockPath, await createLockRecord("memory-write", { runId: "second" }), options),
    ])

    // #then: exactly one owns the replacement and the other observes contention
    expect(contenders.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const rejected = contenders.filter((result) => result.status === "rejected")
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toBeInstanceOf(LockContentionError)
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({ purpose: "memory-write" })
  })

  test("#given link EACCES #when two contenders race the exclusive-create fallback #then exactly one wins", async () => {
    // #given
    const lockPath = await createLockPath()
    restoreLockFs.push(setLockCandidateFsForTests({ link: async () => { throw codedError("EACCES") } }))

    // #when
    const contenders = await Promise.allSettled([
      acquireLock(lockPath, await createLockRecord("facts-queue", { runId: "first" })),
      acquireLock(lockPath, await createLockRecord("facts-queue", { runId: "second" })),
    ])

    // #then
    expect(contenders.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const rejected = contenders.filter((result) => result.status === "rejected")
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toBeInstanceOf(LockContentionError)
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({ purpose: "facts-queue" })
  })

  for (const code of ["EPERM", "ENOTSUP"]) {
    test(`#given link ${code} #when a lock is published #then the exclusive-create fallback succeeds`, async () => {
      const lockPath = await createLockPath()
      restoreLockFs.push(setLockCandidateFsForTests({ link: async () => { throw codedError(code) } }))
      const record = await createLockRecord("reflection-scheduler")

      await acquireLock(lockPath, record)

      expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(record)
    })
  }

  test("#given the fallback writer crashes after exclusive create #when contenders arrive across the grace boundary #then the empty file is held before one contender reclaims it", async () => {
    // #given
    const lockPath = await createLockPath()
    let now = Date.now()
    const events: string[] = []
    restoreLockFs.push(setLockCandidateFsForTests({
      link: async () => { throw codedError("EACCES") },
      writeFallback: async () => {
        events.push("fallback-write")
        throw new Error("simulated writer crash")
      },
      unlink: async (candidatePath) => {
        events.push("candidate-unlink")
        await unlink(candidatePath)
      },
    }))
    const options = { incompleteLockGraceMs: 100, now: () => now }
    await expect(acquireLock(lockPath, await createLockRecord("facts-queue"), options)).rejects.toThrow("simulated writer crash")
    // The candidate is removed only after the fallback settled, so the crash is this call's own
    // rejection and never a promise left pending without a handler while the cleanup runs.
    expect(events).toEqual(["fallback-write", "candidate-unlink"])
    restoreLockFs.pop()?.()
    restoreLockFs.push(setLockCandidateFsForTests({ link: async () => { throw codedError("EACCES") } }))
    now = (await stat(lockPath)).mtimeMs

    // #when / #then: held during grace
    await expect(acquireLock(lockPath, await createLockRecord("facts-queue"), options)).rejects.toBeInstanceOf(LockContentionError)

    // #when / #then: stale after grace and recoverable
    now += 101
    const replacement = await createLockRecord("facts-queue")
    await acquireLock(lockPath, replacement, options)
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(replacement)
  })

  test("#given a non-fallback link error #when a lock is published #then the original error is thrown", async () => {
    const lockPath = await createLockPath()
    restoreLockFs.push(setLockCandidateFsForTests({ link: async () => { throw codedError("EIO") } }))

    await expect(acquireLock(lockPath, await createLockRecord("memory-write"))).rejects.toMatchObject({ code: "EIO" })
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

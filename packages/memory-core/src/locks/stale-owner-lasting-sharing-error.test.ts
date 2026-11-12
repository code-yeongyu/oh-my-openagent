import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import * as resilientFs from "../fs/resilient"
import { LockContentionError, acquireWithoutDirectorySweep } from "./acquire-core"
import { createLockRecord, parseLockRecord, type LockRecord } from "./lock-record"
import { setLockCandidateFsForTests } from "./publish"

// A Windows sharing error on the reclaiming unlink (or the recovery-lock rename) is retried, because a
// releasing owner or a reader can hold a proven-dead record open for a moment (#12089). A refusal that
// outlasts the wait (an ACL that denies delete) must still surface its real code instead of looking
// like plain contention.

const temporaryDirectories: string[] = []
const restores: (() => void)[] = []

afterEach(async () => {
  for (const restore of restores.splice(0)) restore()
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true })
})

function exitedPid(): number {
  const child = Bun.spawnSync([process.execPath, "-e", ""])
  if (child.exitCode !== 0 || child.pid === undefined) throw new Error("could not spawn a short-lived child")
  return child.pid
}

async function lockDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "stale-owner-lasting-sharing-"))
  temporaryDirectories.push(directory)
  return directory
}

async function writeOwner(lockPath: string, owner: LockRecord): Promise<void> {
  await writeFile(lockPath, `${JSON.stringify(owner)}\n`, { mode: 0o600 })
}

async function deadRecord(purpose: string): Promise<LockRecord> {
  return { ...(await createLockRecord(purpose)), pid: exitedPid(), process_start: "unavailable" }
}

function eperm(syscall: string, target: string): Error {
  return Object.assign(new Error(`EPERM: operation not permitted, ${syscall} '${target}'`), { code: "EPERM" })
}

function treatEpermAsSharing(): void {
  restores.push(
    setLockCandidateFsForTests({
      isSharingError: (error) => error instanceof Error && "code" in error && error.code === "EPERM",
    }),
  )
}

/** Fails the first `refusals` unlinks of `lockPath` with EPERM, then lets them through; counts refusals. */
function refuseUnlink(lockPath: string, refusals: number): { readonly refused: () => number } {
  let refused = 0
  const spy = spyOn(resilientFs, "unlink").mockImplementation(async (target) => {
    if (target !== lockPath || refused >= refusals) return unlink(target)
    refused += 1
    throw eperm("unlink", lockPath)
  })
  restores.push(() => spy.mockRestore())
  return { refused: () => refused }
}

/** A clock that advances 1ms per read, so the wait is bounded by attempts, not by wall time. */
function steppingClock(): () => number {
  let tick = 0
  return () => {
    tick += 1
    return tick
  }
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("expected the acquisition to reject")
}

function causeCode(error: unknown): unknown {
  if (!(error instanceof Error) || !(error.cause instanceof Error) || !("code" in error.cause)) return undefined
  return error.cause.code
}

describe("stale-owner reclaim under a lasting Windows sharing error", () => {
  test("#given the dead record's unlink is refused on every attempt #when the wait expires #then the contention error carries the real EPERM", async () => {
    // #given
    const lockPath = path.join(await lockDirectory(), "reflection-run.slot-1.lock")
    await writeOwner(lockPath, await deadRecord("reflection-run"))
    treatEpermAsSharing()
    const unlinks = refuseUnlink(lockPath, Number.POSITIVE_INFINITY)

    // #when
    const error = await rejection(
      acquireWithoutDirectorySweep(lockPath, await createLockRecord("reflection-run"), {
        waitTimeoutMs: 10,
        retryDelayMs: 1,
        now: steppingClock(),
      }),
    )

    // #then
    expect(unlinks.refused()).toBeGreaterThan(1)
    expect(error).toBeInstanceOf(LockContentionError)
    expect(causeCode(error)).toBe("EPERM")
    expect(error instanceof Error ? error.message : "").toContain("EPERM")
    expect(error instanceof LockContentionError ? error.blockedRecord : "not a contention error").toBe("primary")
  })

  test("#given the dead record's unlink is refused twice #when the hold clears #then the waiter takes the lock", async () => {
    // #given
    const lockPath = path.join(await lockDirectory(), "reflection-run.slot-1.lock")
    await writeOwner(lockPath, await deadRecord("reflection-run"))
    treatEpermAsSharing()
    const unlinks = refuseUnlink(lockPath, 2)
    const waiter = await createLockRecord("reflection-run")

    // #when
    await acquireWithoutDirectorySweep(lockPath, waiter, { waitTimeoutMs: 100, retryDelayMs: 1, now: steppingClock() })

    // #then
    expect(unlinks.refused()).toBe(2)
    expect(parseLockRecord(await readFile(lockPath, "utf8"))?.nonce).toBe(waiter.nonce)
  })

  test("#given a dead recovery lock whose rename is refused #when the wait expires #then the contention error carries the real EPERM", async () => {
    // #given
    const lockPath = path.join(await lockDirectory(), "memory-write.lock")
    const recoveryPath = `${lockPath}.recovery`
    await writeOwner(lockPath, await deadRecord("memory-write"))
    await writeOwner(recoveryPath, await deadRecord("memory-write:recovery"))
    treatEpermAsSharing()
    const spy = spyOn(resilientFs, "rename").mockImplementation(async (from, to) => {
      if (from === recoveryPath) throw eperm("rename", recoveryPath)
      return rename(from, to)
    })
    restores.push(() => spy.mockRestore())

    // #when
    const error = await rejection(
      acquireWithoutDirectorySweep(lockPath, await createLockRecord("memory-write"), { waitTimeoutMs: 0 }),
    )

    // #then
    expect(error).toBeInstanceOf(LockContentionError)
    expect(causeCode(error)).toBe("EPERM")
    expect(error instanceof LockContentionError ? error.blockedRecord : "not a contention error").toBe("recovery")
  })

  test("#given a live owner #when the wait expires #then the contention error has no cause", async () => {
    // #given
    const lockPath = path.join(await lockDirectory(), "memory-write.lock")
    await writeOwner(lockPath, await createLockRecord("memory-write"))

    // #when
    const error = await rejection(
      acquireWithoutDirectorySweep(lockPath, await createLockRecord("memory-write"), { waitTimeoutMs: 0 }),
    )

    // #then
    expect(error).toBeInstanceOf(LockContentionError)
    expect(error instanceof Error ? error.cause : "not an error").toBeUndefined()
    expect(error instanceof Error ? error.message : "").toBe(`Lock is held: ${lockPath}`)
  })
})

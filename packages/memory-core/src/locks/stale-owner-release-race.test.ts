import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import * as resilientFs from "../fs/resilient"
import { acquireWithoutDirectorySweep } from "./acquire-core"
import { createLockRecord, parseLockRecord, type LockRecord } from "./lock-record"
import { setLockCandidateFsForTests } from "./publish"

// A counting lease retained for a child records the child's pid, so once the child exits the slot
// record is provably dead while its supervisor is still alive and about to release it. A waiter that
// proves the record dead races that release for the same unlink (#12089).

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

async function slotHeldByExitedChild(): Promise<{ readonly lockPath: string; readonly owner: LockRecord }> {
  const directory = await mkdtemp(path.join(tmpdir(), "stale-owner-release-race-"))
  temporaryDirectories.push(directory)
  const lockPath = path.join(directory, "reflection-run.slot-1.lock")
  const owner = { ...(await createLockRecord("reflection-run")), pid: exitedPid(), process_start: "unavailable" }
  await writeFile(lockPath, `${JSON.stringify(owner)}\n`, { mode: 0o600 })
  return { lockPath, owner }
}

/** The owner's own release lands just before the waiter's reclaiming unlink of the primary. */
function releaseByOwnerBeforeReclaim(lockPath: string, loserError: () => Promise<never>): void {
  let raced = false
  const reclaim = spyOn(resilientFs, "unlink").mockImplementation(async (target) => {
    if (raced || target !== lockPath) return unlink(target)
    raced = true
    await unlink(lockPath)
    return loserError()
  })
  restores.push(() => reclaim.mockRestore())
}

async function heldNonce(lockPath: string): Promise<string | undefined> {
  return parseLockRecord(await readFile(lockPath, "utf8"))?.nonce
}

describe("stale-owner recovery racing the owner's release", () => {
  test("#given the owner removes its dead-pid record first #when the waiter's unlink finds it gone #then the waiter takes the free lock", async () => {
    // #given
    const { lockPath } = await slotHeldByExitedChild()
    releaseByOwnerBeforeReclaim(lockPath, async () => {
      await unlink(lockPath)
      throw new Error("unreachable: the second unlink must fail")
    })
    const waiter = await createLockRecord("reflection-run")

    // #when
    await acquireWithoutDirectorySweep(lockPath, waiter, { waitTimeoutMs: 0 })

    // #then
    expect(await heldNonce(lockPath)).toBe(waiter.nonce)
  })

  test("#given the owner's release still holds the record open #when the waiter's unlink hits a Windows sharing error #then the waiter retries instead of failing", async () => {
    // #given
    const { lockPath } = await slotHeldByExitedChild()
    restores.push(setLockCandidateFsForTests({ isSharingError: (error) => error instanceof Error && "code" in error && error.code === "EPERM" }))
    releaseByOwnerBeforeReclaim(lockPath, async () => {
      throw Object.assign(new Error(`EPERM: operation not permitted, unlink '${lockPath}'`), { code: "EPERM" })
    })
    const waiter = await createLockRecord("reflection-run")

    // #when
    await acquireWithoutDirectorySweep(lockPath, waiter, { waitTimeoutMs: 5_000, retryDelayMs: 1 })

    // #then
    expect(await heldNonce(lockPath)).toBe(waiter.nonce)
  })
})

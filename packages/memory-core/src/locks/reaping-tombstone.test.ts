import { afterEach, expect, spyOn, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"

import * as resilientFs from "../fs/resilient"
import { acquireWithoutDirectorySweep } from "./acquire-core"
import { REAPING_STALE_AGE_MS, sweepDeadOwnerLocks } from "./dead-owner-sweep"
import { readOwner } from "./lock-owner"
import { createLockRecord, type LockRecord } from "./lock-record"
import { recoverStaleOwner } from "./stale-owner"

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function lockDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "reaping-tombstone-"))
  dirs.push(dir)
  return dir
}

async function exitedPid(): Promise<number> {
  const child = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore", stderr: "ignore" })
  expect(await child.exited).toBe(0)
  return child.pid
}

function record(nonce: string, pid: number, host = hostname()): LockRecord {
  return {
    pid,
    process_start: "unavailable",
    hostname: host,
    nonce,
    created_at: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    purpose: "fixture",
  }
}

async function put(path: string, value: LockRecord | string): Promise<void> {
  await writeFile(path, typeof value === "string" ? value : JSON.stringify(value))
}

const tombstone = (key: string, n: number) => `${key}.reaping-00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

/** A sweep clock past the tombstone age limit, fixed once the fixture files exist. */
function agedClock(): () => number {
  const at = Date.now() + 2 * REAPING_STALE_AGE_MS
  return () => at
}

test("#11659 I1 guard: a fresh live holder remains the owner after a competing acquisition", async () => {
  const lockPath = join(await lockDir(), "writer.lock")
  const holder = await createLockRecord("holder")
  await put(lockPath, holder)
  await expect(
    acquireWithoutDirectorySweep(lockPath, await createLockRecord("contender"), { waitTimeoutMs: 0 }),
  ).rejects.toThrow("Lock is held")
  expect((await readOwner(lockPath))?.record).toEqual(holder)
})

test("#11659 I2 guard: a holder whose recovery record was moved away and not restored never unlinks the primary", async () => {
  const dir = await lockDir()
  const lockPath = join(dir, "writer.lock")
  const recoveryPath = `${lockPath}.recovery`
  const dead = record("dead-primary", await exitedPid())
  await put(lockPath, dead)
  const snapshot = await readOwner(lockPath)
  if (snapshot === null) throw new Error("fixture primary missing")
  const realReadFile = resilientFs.readFile
  let displaced = false
  const displace = spyOn(resilientFs, "readFile").mockImplementation((async (target: string, ...rest: unknown[]) => {
    // A rival reaper takes the holder's fresh recovery record and its put-back fails.
    if (!displaced && target === lockPath && existsSync(recoveryPath)) {
      displaced = true
      await rename(recoveryPath, tombstone(recoveryPath, 1))
    }
    return (realReadFile as (...args: unknown[]) => Promise<string>)(target, ...rest)
  }) as typeof resilientFs.readFile)
  try {
    const recovered = await recoverStaleOwner(lockPath, snapshot, await createLockRecord("holder"), Date.now(), 5_000)
    expect(displaced).toBe(true)
    expect(recovered).toBe(false)
  } finally {
    displace.mockRestore()
  }
  expect((await readOwner(lockPath))?.record?.nonce).toBe(dead.nonce)
})

test("#15273 H1: an aged tombstone of a live process's released recovery record is removed, not restored", async () => {
  const dir = await lockDir()
  const lockPath = join(dir, "writer.lock")
  await put(lockPath, record("dead-primary", await exitedPid()))
  await put(tombstone(`${lockPath}.recovery`, 1), record("released-recovery", process.pid))
  await sweepDeadOwnerLocks(dir, { now: agedClock() })
  expect(await readdir(dir)).toEqual([])
  await put(lockPath, record("dead-again", await exitedPid()))
  const contender = await createLockRecord("memory-write")
  await acquireWithoutDirectorySweep(lockPath, contender, { waitTimeoutMs: 0 })
  expect((await readOwner(lockPath))?.record?.nonce).toBe(contender.nonce)
})

test("#15273 M1: a fresh tombstone a reaper may still be inspecting is left alone", async () => {
  const dir = await lockDir()
  const fresh = tombstone(join(dir, "writer.lock.recovery"), 1)
  await put(fresh, record("dead-recovery", await exitedPid()))
  await sweepDeadOwnerLocks(dir)
  expect(await readdir(dir)).toEqual(["writer.lock.recovery.reaping-00000000-0000-4000-8000-000000000001"])
})

test("#15273 M1: a reaper whose tombstone a concurrent sweep removed treats the recovery lock as freed", async () => {
  const dir = await lockDir()
  const lockPath = join(dir, "writer.lock")
  await put(lockPath, record("dead-primary", await exitedPid()))
  await put(`${lockPath}.recovery`, record("dead-recovery", await exitedPid()))
  const realRename = resilientFs.rename
  const sweptAway = spyOn(resilientFs, "rename").mockImplementation((async (from: string, to: string) => {
    await realRename(from, to)
    if (to.includes(".reaping-")) await unlink(to)
  }) as typeof resilientFs.rename)
  const contender = await createLockRecord("memory-write")
  try {
    await acquireWithoutDirectorySweep(lockPath, contender, { waitTimeoutMs: 0 })
  } finally {
    sweptAway.mockRestore()
  }
  expect((await readOwner(lockPath))?.record?.nonce).toBe(contender.nonce)
  expect(await readdir(dir)).toEqual(["writer.lock"])
})

test("#11659 item 3, #15273 L2: aged tombstones are collected whatever they hold, the live lock is kept", async () => {
  const dir = await lockDir()
  const lockPath = join(dir, "writer.lock")
  const live = await createLockRecord("live")
  await put(lockPath, live)
  const key = `${lockPath}.recovery`
  await put(tombstone(key, 1), record("dead", await exitedPid()))
  await put(tombstone(key, 2), "{not a record")
  await put(tombstone(key, 3), record("other-host", 1, "elsewhere.invalid"))
  await sweepDeadOwnerLocks(dir, { now: agedClock() })
  expect(await readdir(dir)).toEqual(["writer.lock"])
  expect(JSON.parse(await readFile(lockPath, "utf8")).nonce).toBe(live.nonce)
})

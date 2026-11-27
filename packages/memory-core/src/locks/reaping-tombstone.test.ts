import { expect, test } from "bun:test"
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"

import { sweepStaleLockCandidates } from "./candidate-sweep"
import { sweepDeadOwnerLocks } from "./dead-owner-sweep"
import { acquireWithoutDirectorySweep, LockContentionError } from "./acquire-core"
import { readOwner } from "./lock-owner"
import type { LockRecord } from "./lock-record"

const fixedTime = Date.UTC(2026, 0, 1)

function liveRecord(nonce: string): LockRecord {
  return {
    hostname: hostname(),
    pid: process.pid,
    nonce,
    process_start: "unavailable",
    created_at: new Date(fixedTime).toISOString(),
    purpose: "fixture",
  }
}

test("#11659 I1: a fresh live holder remains the owner after a competing acquisition", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fresh-owner-"))
  try {
    const key = join(dir, "writer.lock")
    const holder = liveRecord("original")
    await writeFile(key, JSON.stringify(holder))
    await utimes(key, fixedTime / 1000, fixedTime / 1000)
    await expect(
      acquireWithoutDirectorySweep(key, liveRecord("contender"), { now: () => fixedTime, waitTimeoutMs: 0 }),
    ).rejects.toBeInstanceOf(LockContentionError)
    expect((await readOwner(key))?.record).toEqual(holder)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("#11659 I2: a restore-error snapshot retains a discoverable live owner after directory recovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "restore-error-snapshot-"))
  try {
    const key = join(dir, "writer.lock.recovery")
    const saved = `${key}.reaping-00000000-0000-4000-8000-000000000003`
    const holder = liveRecord("original")
    await writeFile(saved, JSON.stringify(holder))
    await utimes(saved, fixedTime / 1000, fixedTime / 1000)
    await sweepStaleLockCandidates(dir, () => fixedTime)
    await sweepDeadOwnerLocks(dir)
    expect((await readOwner(key))?.record).toEqual(holder)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("#11659: sweeping a three-owner snapshot preserves live records and collects the abandoned tombstone", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reaping-snapshot-"))
  try {
    const clock = Date.UTC(2026, 0, 1)
    const child = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore", stderr: "ignore" })
    expect(await child.exited).toBe(0)
    const primary = "writer.lock.recovery"
    const displaced = "writer.lock.recovery.reaping-00000000-0000-4000-8000-000000000001"
    const abandoned = "writer.lock.recovery.reaping-00000000-0000-4000-8000-000000000002"
    for (const [name, pid] of [
      [primary, process.pid],
      [displaced, process.pid],
      [abandoned, child.pid],
    ] as const) {
      const record = {
        hostname: hostname(),
        pid,
        nonce: name,
        process_start: "unavailable",
        created_at: new Date(clock).toISOString(),
        purpose: "fixture",
      }
      await writeFile(join(dir, name), JSON.stringify(record))
      await utimes(join(dir, name), clock / 1000, clock / 1000)
    }
    await sweepStaleLockCandidates(dir, () => clock + 86_400_000)
    await sweepDeadOwnerLocks(dir)
    expect((await readdir(dir)).sort()).toEqual([primary, displaced].sort())
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

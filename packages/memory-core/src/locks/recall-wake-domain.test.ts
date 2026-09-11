import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { acquireRecallWakeLease, recallWakeLockPath, withRecallWakeLease } from "./index"
import { createLockRecord } from "./lock-record"

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })
async function fixture(): Promise<string> { const dir = await mkdtemp(path.join(tmpdir(), "recall-wake-")); dirs.push(dir); return dir }

describe("recall-wake lock domain", () => {
  test("#given an empty domain #when a lease is acquired #then it reports a positive count and releases", async () => {
    const dir = await fixture()
    const lease = await acquireRecallWakeLease(dir)
    expect(lease.count).toBeGreaterThan(0)
    expect(await lease.release()).toBe(true)
  })

  test("#given a live owner #when another lease has no wait budget #then contention is preserved", async () => {
    const dir = await fixture()
    const owner = await acquireRecallWakeLease(dir)
    await expect(acquireRecallWakeLease(dir)).rejects.toThrow()
    expect(await owner.release()).toBe(true)
  })

  test("#given a dead owner record #when the domain is acquired #then stale ownership is recovered", async () => {
    const dir = await fixture()
    const lockPath = recallWakeLockPath(dir)
    const stale = await createLockRecord("recall-wake")
    await writeFile(lockPath, JSON.stringify({ ...stale, pid: 99999999, process_start: "proc-start-epoch:0" }) + "\n")
    const lease = await acquireRecallWakeLease(dir, { waitTimeoutMs: 5_000, retryDelayMs: 10 })
    expect(lease.count).toBeGreaterThan(0)
    expect(JSON.parse(await readFile(lockPath, "utf8")).purpose).toBe("recall-wake")
    expect(await lease.release()).toBe(true)
  })

  test("#given a callback #when it completes #then the counting lease is released", async () => {
    const dir = await fixture()
    const result = await withRecallWakeLease(dir, async (lease) => lease.count)
    expect(result).toBeGreaterThan(0)
  })
})

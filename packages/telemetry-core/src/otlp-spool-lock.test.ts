import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { CLAIM_LEASE_MS, claimBatch, createBatchId, renewClaim, sweepSpool, type SpoolContext } from "./otlp-spool-dir"
import { isSpoolFileName, lockName, parseSpoolName } from "./otlp-spool-names"
import { createSpoolRoot, spoolNames } from "./otlp-test-support"

const DAY_MS = 24 * 60 * 60 * 1000
const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

function root(): string {
  const created = createSpoolRoot("telemetry-core-lock-")
  roots.push(created.cleanup)
  mkdirSync(created.dir, { recursive: true })
  return created.dir
}

function context(dir: string, overrides: Partial<SpoolContext> = {}): SpoolContext {
  return {
    dir,
    bootId: "c".repeat(32),
    pid: 1,
    nowMs: Date.now,
    isPidAlive: () => true,
    capBytes: 5 * 1024 * 1024,
    maxAgeMs: 14 * DAY_MS,
    onDrop: () => undefined,
    ...overrides,
  }
}

// Windows rename semantics as CI observed them: a racer that read the source before the other one
// moved it still "succeeds", so two renames of one file to different names both report success.
async function copyThenUnlink(from: string, to: string): Promise<void> {
  const bytes = readFileSync(from)
  await new Promise((resolve) => setImmediate(resolve))
  writeFileSync(to, bytes)
  rmSync(from, { force: true })
}

describe("spool move lock", () => {
  test("#given a rename that lets two racers both succeed #when two sweepers claim one batch #then exactly one claim wins and one sending file exists", async () => {
    // given
    const dir = root()
    const batchId = createBatchId(Date.now())
    writeFileSync(join(dir, `batch-logs-${batchId}.otlp`), "records")

    // when
    const claims = await Promise.all([
      claimBatch(context(dir, { bootId: "1".repeat(32) }), { signal: "logs", batchId }, copyThenUnlink),
      claimBatch(context(dir, { bootId: "2".repeat(32) }), { signal: "logs", batchId }, copyThenUnlink),
    ])

    // then
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1)
    expect(spoolNames(dir).filter((name) => parseSpoolName(name).kind === "sending")).toHaveLength(1)
    expect(spoolNames(dir).filter((name) => parseSpoolName(name).kind === "lock")).toEqual([])
  })

  test("#given another mover holds the batch's lock #when a sweeper claims it #then it skips and the batch stays sealed", async () => {
    // given
    const dir = root()
    const batchId = createBatchId(Date.now())
    const batch = `batch-logs-${batchId}.otlp`
    writeFileSync(join(dir, batch), "records")
    writeFileSync(join(dir, lockName(batch)), "")

    // when
    const claimed = await claimBatch(context(dir), { signal: "logs", batchId })

    // then
    expect(claimed).toBeNull()
    expect(spoolNames(dir)).toEqual([batch, lockName(batch)].sort())
  })

  test("#given a locked claim #when its owner renews or a sweeper reclaims the expired lease #then neither moves it", () => {
    // given
    const dir = root()
    const now = Date.now()
    const claim = `batch-logs-${createBatchId(now)}.sending-${"c".repeat(32)}-${now - 1}`
    writeFileSync(join(dir, claim), "records")
    writeFileSync(join(dir, lockName(claim)), "")

    // when
    const renewed = renewClaim(context(dir), claim)
    sweepSpool(context(dir))

    // then
    expect(renewed).toBeNull()
    expect(spoolNames(dir)).toEqual([claim, lockName(claim)].sort())
  })

  test("#given a lock older than the claim lease and a fresh one #when the sweep runs #then only the stale lock is deleted", () => {
    // given
    const dir = root()
    const stale = lockName(`batch-logs-${createBatchId(Date.now())}.otlp`)
    const fresh = lockName(`batch-traces-${createBatchId(Date.now())}.otlp`)
    writeFileSync(join(dir, stale), "")
    writeFileSync(join(dir, fresh), "")
    const old = (Date.now() - CLAIM_LEASE_MS - 1_000) / 1000
    utimesSync(join(dir, stale), old, old)

    // when
    sweepSpool(context(dir))

    // then
    expect(spoolNames(dir)).toEqual([fresh])
  })

  test("#given lock names #then only a lock on a spool file name is a spool file, so the opt-out purge deletes it and nothing else", () => {
    const batch = `batch-logs-${createBatchId(Date.now())}.otlp`
    expect(parseSpoolName(lockName(batch))).toEqual({ kind: "lock", name: lockName(batch), target: batch })
    expect(isSpoolFileName(lockName(batch))).toBe(true)
    expect(isSpoolFileName("notes.txt.lock")).toBe(false)
    expect(isSpoolFileName(lockName(lockName(batch)))).toBe(false)
  })
})

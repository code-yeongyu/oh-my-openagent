import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { CLAIM_LEASE_MS, createBatchId, sweepSpool, type SpoolContext } from "./otlp-spool-dir"
import { tryLockSync, unlock } from "./otlp-spool-lock"
import { batchName, lockName } from "./otlp-spool-names"
import { createSpoolRoot, spoolNames } from "./otlp-test-support"

const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

function spool(): { readonly dir: string; readonly ctx: SpoolContext } {
  const root = createSpoolRoot("telemetry-core-lock-owner-")
  roots.push(root.cleanup)
  mkdirSync(root.dir, { recursive: true })
  const ctx: SpoolContext = {
    dir: root.dir,
    bootId: "a".repeat(32),
    pid: process.pid,
    nowMs: Date.now,
    isPidAlive: () => true,
    capBytes: 5 * 1024 * 1024,
    maxAgeMs: 14 * 86_400_000,
    onDrop: () => undefined,
  }
  return { dir: root.dir, ctx }
}

function sealedBatch(dir: string): { readonly name: string } {
  const name = batchName("logs", createBatchId(Date.now()))
  writeFileSync(join(dir, name), "records")
  return { name }
}

describe("a lock is only ever its owner's", () => {
  test("#given a lock deleted under its mover and taken by another #when the first mover unlocks #then the second mover's lock stays", () => {
    // given
    const { dir } = spool()
    const { name } = sealedBatch(dir)
    const first = tryLockSync(dir, name, { pid: process.pid, bootId: "a".repeat(32) })
    unlinkSync(join(dir, lockName(name)))
    tryLockSync(dir, name, { pid: process.pid, bootId: "b".repeat(32) })
    const secondLock = readFileSync(join(dir, lockName(name)), "utf8")

    // when
    if (first !== null) unlock(dir, name, first)

    // then
    expect(existsSync(join(dir, lockName(name)))).toBe(true)
    expect(readFileSync(join(dir, lockName(name)), "utf8")).toBe(secondLock)
  })

  test("#given stale locks #then the sweep keeps the one whose owner pid is alive and deletes the dead owner's", () => {
    // given
    const { dir, ctx } = spool()
    const live = lockName(batchName("logs", createBatchId(Date.now())))
    const dead = lockName(batchName("traces", createBatchId(Date.now())))
    writeFileSync(join(dir, live), `111 ${"c".repeat(32)} nonce`)
    writeFileSync(join(dir, dead), `222 ${"d".repeat(32)} nonce`)
    const stale = new Date(Date.now() - CLAIM_LEASE_MS - 1_000)
    utimesSync(join(dir, live), stale, stale)
    utimesSync(join(dir, dead), stale, stale)

    // when
    sweepSpool({ ...ctx, isPidAlive: (pid) => pid === 111 })

    // then
    expect(spoolNames(dir)).toEqual([live])
  })

  test("#given stale locks naming our own pid #then the sweep deletes the one from an earlier boot and keeps the one this process holds", () => {
    // given
    const { dir, ctx } = spool()
    const earlierBoot = lockName(batchName("logs", createBatchId(Date.now())))
    const heldSource = batchName("traces", createBatchId(Date.now()))
    const held = lockName(heldSource)
    writeFileSync(join(dir, earlierBoot), `${ctx.pid} ${"e".repeat(32)} nonce`)
    const token = tryLockSync(dir, heldSource, ctx)
    const stale = new Date(Date.now() - CLAIM_LEASE_MS - 1_000)
    utimesSync(join(dir, earlierBoot), stale, stale)
    utimesSync(join(dir, held), stale, stale)

    // when
    sweepSpool({ ...ctx, isPidAlive: (pid) => pid === ctx.pid })

    // then
    expect(spoolNames(dir)).toEqual([held])
    if (token !== null) unlock(dir, heldSource, token)
  })

  test("#given a stale lock of this process that its unlock could not delete #when the sweep runs #then the lock is deleted", () => {
    // given
    const { dir, ctx } = spool()
    const source = batchName("logs", createBatchId(Date.now()))
    const token = tryLockSync(dir, source, ctx)
    expect(token).not.toBeNull()
    const left: unknown[] = []
    const lockPath = join(dir, lockName(source))
    const kept = readFileSync(lockPath, "utf8")
    unlinkSync(lockPath)
    // A lock the unlock could not delete: the unlock ran (and gave up) while the file stayed behind.
    unlock(dir, source, token ?? "", (error) => left.push(error))
    writeFileSync(lockPath, kept)
    const stale = new Date(Date.now() - CLAIM_LEASE_MS - 1_000)
    utimesSync(lockPath, stale, stale)

    // when
    sweepSpool(ctx)

    // then
    expect(existsSync(lockPath)).toBe(false)
  })
})

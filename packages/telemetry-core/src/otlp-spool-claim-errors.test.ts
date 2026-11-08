import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs"
import { rename } from "node:fs/promises"
import { join } from "node:path"

import { claimBatch, createBatchId, type SpoolContext } from "./otlp-spool-dir"
import { batchName, lockName } from "./otlp-spool-names"
import { capture, createSpoolRoot, makeTransport, recordingFetch, spoolNames } from "./otlp-test-support"
import type { TelemetryDiagnosticInput } from "./types"

const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

// The failures below come from directory permission bits, which bind neither on Windows nor as root.
const permissionsBind = process.platform !== "win32" && process.getuid?.() !== 0
const readOnly = (dir: string): void => chmodSync(dir, 0o555)
const writable = (dir: string): void => chmodSync(dir, 0o755)
const ioError = (code: string): Error => Object.assign(new Error(code), { code })

function spool(): { readonly dir: string; readonly ctx: SpoolContext; readonly lockLeft: unknown[] } {
  const root = createSpoolRoot("telemetry-core-claim-errors-")
  const dir = root.dir
  roots.push(() => {
    writable(dir)
    root.cleanup()
  })
  mkdirSync(dir, { recursive: true })
  const lockLeft: unknown[] = []
  const ctx: SpoolContext = {
    dir,
    bootId: "a".repeat(32),
    pid: process.pid,
    nowMs: Date.now,
    isPidAlive: () => true,
    capBytes: 5 * 1024 * 1024,
    maxAgeMs: 14 * 86_400_000,
    onDrop: () => undefined,
    onLockLeft: (error) => lockLeft.push(error),
  }
  return { dir, ctx, lockLeft }
}

function sealedBatch(dir: string): { readonly batchId: string; readonly name: string } {
  const batchId = createBatchId(Date.now())
  const name = batchName("logs", batchId)
  writeFileSync(join(dir, name), "records")
  return { batchId, name }
}

describe("every throw in a claim leaves the spool consistent", () => {
  test.skipIf(!permissionsBind)("#given the lock cannot be created #then the claim throws and the batch keeps its name", async () => {
    // given
    const { dir, ctx } = spool()
    const { batchId, name } = sealedBatch(dir)
    readOnly(dir)

    // when
    const claiming = claimBatch(ctx, { signal: "logs", batchId })

    // then
    await expect(claiming).rejects.toThrow()
    writable(dir)
    expect(spoolNames(dir)).toEqual([name])
  })

  test("#given a move that copies and then fails (a Windows rename) #then the copy is removed and only the batch remains", async () => {
    // given
    const { dir, ctx } = spool()
    const { batchId, name } = sealedBatch(dir)
    const copyThenFail = async (from: string, to: string): Promise<void> => {
      copyFileSync(from, to)
      throw ioError("EBUSY")
    }

    // when
    const claiming = claimBatch(ctx, { signal: "logs", batchId }, copyThenFail)

    // then
    await expect(claiming).rejects.toThrow("EBUSY")
    expect(spoolNames(dir)).toEqual([name])
  })

  test("#given a move that happened but reported an error #then the move is undone and the batch keeps its name", async () => {
    // given
    const { dir, ctx } = spool()
    const { batchId, name } = sealedBatch(dir)
    const moveThenFail = async (from: string, to: string): Promise<void> => {
      await rename(from, to)
      throw ioError("EIO")
    }

    // when
    const claiming = claimBatch(ctx, { signal: "logs", batchId }, moveThenFail)

    // then
    await expect(claiming).rejects.toThrow("EIO")
    expect(spoolNames(dir)).toEqual([name])
  })

  test.skipIf(!permissionsBind)("#given a claim whose lock cannot be deleted #then the claim stands and the leftover lock is reported", async () => {
    // given
    const { dir, ctx, lockLeft } = spool()
    const { batchId, name } = sealedBatch(dir)
    const moveThenSeal = async (from: string, to: string): Promise<void> => {
      await rename(from, to)
      readOnly(dir)
    }

    // when
    const claimed = await claimBatch(ctx, { signal: "logs", batchId }, moveThenSeal)

    // then
    writable(dir)
    expect(claimed).toContain(`batch-logs-${batchId}.sending-`)
    expect(lockLeft).toHaveLength(1)
    expect(spoolNames(dir)).toEqual([claimed ?? "", lockName(name)].sort())
  })

  test.skipIf(!permissionsBind)("#given a sealed batch whose claim cannot take its lock #then the flush resolves, reports it and keeps the batch", async () => {
    // given
    const { dir } = spool()
    const first = makeTransport(dir, { fetch: recordingFetch(() => new Response(null, { status: 503 })).fetch })
    capture(first, "feature_used", { feature: "a" })
    await first.flush()
    const kept = spoolNames(dir)
    const diagnostics: TelemetryDiagnosticInput[] = []
    const second = makeTransport(dir, { diagnostics: (input) => diagnostics.push(input) })
    readOnly(dir)

    // when
    const flushing = second.flush()

    // then
    await expect(flushing).resolves.toBeUndefined()
    writable(dir)
    expect(diagnostics.map(({ event }) => event)).toContain("telemetry_otlp_send_failed")
    expect(spoolNames(dir)).toEqual(kept)
  })

  test.skipIf(!permissionsBind)("#given an in-flight claim whose renewal cannot take its lock #then the renewal reports it instead of throwing from the timer", async () => {
    // given
    const { dir } = spool()
    let now = Date.now()
    let onNow: (() => void) | undefined
    const nextClockRead = (): Promise<void> => new Promise((resolve) => {
      onNow = () => {
        onNow = undefined
        resolve()
      }
    })
    let markAsleep: () => void = () => undefined
    const asleep = new Promise<void>((resolve) => {
      markAsleep = resolve
    })
    const diagnostics: TelemetryDiagnosticInput[] = []
    const transport = makeTransport(dir, {
      nowMs: () => {
        onNow?.()
        return now
      },
      leaseRenewIntervalMs: 5,
      requestTimeoutMs: 100,
      diagnostics: (input) => diagnostics.push(input),
      fetch: recordingFetch(() => new Response(null, { status: 503 })).fetch,
      sleep: (_ms, abort) => {
        markAsleep()
        return new Promise<void>((resolve) => abort.addEventListener("abort", () => resolve(), { once: true }))
      },
    })
    capture(transport, "feature_used", { feature: "a" })
    const flushing = transport.flush()
    await asleep
    readOnly(dir)

    // when
    now += 1_000
    await nextClockRead()
    await nextClockRead()

    // then
    writable(dir)
    expect(diagnostics.map(({ event }) => event)).toContain("telemetry_spool_write_failed")
    await transport.shutdown()
    await flushing
  })
})

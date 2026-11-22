import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { enforceSpoolCap } from "./otlp-spool-cap"
import { createBatchId, sweepSpool, type DropReason, type SpoolContext } from "./otlp-spool-dir"
import { createSpoolRoot, spoolNames } from "./otlp-test-support"

const DAY_MS = 24 * 60 * 60 * 1000
const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

function root(): string {
  const created = createSpoolRoot("telemetry-core-quarantine-")
  roots.push(created.cleanup)
  mkdirSync(join(created.dir, "quarantine"), { recursive: true })
  return created.dir
}

function context(dir: string, drops: [DropReason, number][], overrides: Partial<SpoolContext> = {}): SpoolContext {
  return {
    dir,
    bootId: "c".repeat(32),
    pid: 1,
    nowMs: Date.now,
    isPidAlive: () => true,
    capBytes: 10_000,
    maxAgeMs: 14 * DAY_MS,
    onDrop: (reason, records) => void drops.push([reason, records]),
    ...overrides,
  }
}

describe("quarantine is bounded", () => {
  test("#given quarantined files #then they count toward the cap and are evicted before any sendable batch, without being counted twice", () => {
    // given
    const dir = root()
    const quarantined = `batch-logs-${createBatchId(Date.now() - 1_000)}.otlp`
    writeFileSync(join(dir, "quarantine", quarantined), new Uint8Array(8_000))
    const sealed = `batch-logs-${createBatchId(Date.now())}.otlp`
    writeFileSync(join(dir, sealed), new Uint8Array(4_000))
    const drops: [DropReason, number][] = []

    // when
    const total = enforceSpoolCap(context(dir, drops))

    // then
    expect(spoolNames(join(dir, "quarantine"))).toEqual([])
    expect(spoolNames(dir)).toEqual([sealed, "quarantine"].sort())
    expect(total).toBeLessThanOrEqual(10_000)
    expect(drops).toEqual([])
  })

  test("#given a quarantined file older than the age limit #when the sweep runs #then it is deleted and a fresh one stays", () => {
    // given
    const dir = root()
    const old = `batch-logs-${createBatchId(Date.now() - 20 * DAY_MS)}.otlp`
    const fresh = `batch-traces-${createBatchId(Date.now())}.otlp`
    writeFileSync(join(dir, "quarantine", old), "x")
    writeFileSync(join(dir, "quarantine", fresh), "y")
    const past = new Date(Date.now() - 15 * DAY_MS)
    utimesSync(join(dir, "quarantine", old), past, past)

    // when
    sweepSpool(context(dir, []))

    // then
    expect(spoolNames(join(dir, "quarantine"))).toEqual([fresh])
  })
})

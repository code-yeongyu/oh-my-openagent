import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  BATCH_ID_COUNTER_LIMIT,
  batchCreatedMs,
  createBatchId,
  nextBatchIdCounter,
  oldestSealedBatches,
  type BatchIdCounter,
} from "./otlp-spool-dir"
import { createSpoolRoot } from "./otlp-test-support"

const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

describe("batch ids", () => {
  test("#given 1,000 ids created in the same millisecond #then sorting them reproduces creation order", () => {
    // given
    const ms = 1_760_000_000_000

    // when
    const ids = Array.from({ length: 1_000 }, () => createBatchId(ms))

    // then
    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(1_000)
    expect(ids.every((id) => batchCreatedMs(id) === ms)).toBe(true)
  })

  test("#given sealed batches whose ids share one millisecond #then they are listed for sending in seal order", () => {
    // given
    const created = createSpoolRoot("telemetry-core-batch-id-")
    roots.push(created.cleanup)
    mkdirSync(created.dir, { recursive: true })
    const ms = 1_760_000_000_000
    const ids = Array.from({ length: 50 }, () => createBatchId(ms))
    for (const [index, id] of ids.entries()) {
      writeFileSync(join(created.dir, `batch-${index % 2 === 0 ? "logs" : "traces"}-${id}.otlp`), "")
    }

    // when
    const listed = oldestSealedBatches(created.dir).map((entry) => entry.batchId)

    // then
    expect(listed).toEqual(ids)
  })

  // The documented limit of the counter (otlp-spool-dir.ts, createBatchId): order survives ONE
  // counter overflow while the clock stays one millisecond behind the advanced timestamp; after a
  // second overflow in that same clock millisecond the counter reseeds and the order can break.
  const after = (a: BatchIdCounter, b: BatchIdCounter): boolean => b.ms > a.ms || (b.ms === a.ms && b.counter > a.counter)
  const seed = (): number => 0
  const T = 1_760_000_000_000

  test("#given the counter overflows once #when the clock still reads the old millisecond #then the ids keep increasing", () => {
    // given
    const full: BatchIdCounter = { ms: T, counter: BATCH_ID_COUNTER_LIMIT - 1, overflowed: false }

    // when
    const overflowed = nextBatchIdCounter(full, T, seed)
    const next = nextBatchIdCounter(overflowed, T, seed)

    // then
    expect(overflowed).toEqual({ ms: T + 1, counter: 0, overflowed: true })
    expect(after(full, overflowed) && after(overflowed, next)).toBe(true)
  })

  test("#given the counter overflows twice within one clock millisecond #then the next id reseeds at that millisecond (the documented limit)", () => {
    // given
    const twice = nextBatchIdCounter({ ms: T + 1, counter: BATCH_ID_COUNTER_LIMIT - 1, overflowed: true }, T, seed)

    // when
    const next = nextBatchIdCounter(twice, T, seed)

    // then
    expect(twice).toEqual({ ms: T + 2, counter: 0, overflowed: true })
    expect(next.ms).toBe(T)
    expect(after(twice, next)).toBe(false)
  })

  test("#given an older timestamp after a newer one #then the id keeps its own creation time", () => {
    // given
    createBatchId(1_760_000_000_000)

    // when
    const old = createBatchId(1_700_000_000_000)

    // then
    expect(batchCreatedMs(old)).toBe(1_700_000_000_000)
  })
})

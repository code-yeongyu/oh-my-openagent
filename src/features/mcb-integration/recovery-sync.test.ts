import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { getMcbAvailability, markMcbUnavailable, resetMcbAvailability } from "./availability"
import { attemptRecoverySync } from "./recovery-sync"
import { peekQueue, saveQueue } from "./sync-queue"
import type { QueuedMcbOperation } from "./sync-queue-types"

const TEST_DIR = join(tmpdir(), `mcb-recovery-sync-test-${Date.now()}`)

function makeOperation(overrides: Partial<QueuedMcbOperation> = {}): QueuedMcbOperation {
  return {
    id: `op-${Date.now()}-${Math.random()}`,
    tool: "memory",
    action: "store",
    params: { value: "x" },
    queuedAt: Date.now(),
    retryCount: 0,
    maxRetries: 3,
    source: "test",
    ...overrides,
  }
}

describe("mcb-integration/recovery-sync", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
    resetMcbAvailability()
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  //#given queued operations
  //#when recovery sync runs with successful executor
  //#then operations are replayed and queue is cleared
  it("replays queued operations and clears queue on success", async () => {
    await saveQueue(TEST_DIR, [makeOperation({ id: "a" }), makeOperation({ id: "b" })])
    const replayed: string[] = []

    const result = await attemptRecoverySync(TEST_DIR, async (operation) => {
      replayed.push(operation.id)
    })

    expect(result.replayed).toBe(2)
    expect(result.failed).toBe(0)
    expect(result.discarded).toBe(0)
    expect(replayed).toEqual(["a", "b"])
    expect(await peekQueue(TEST_DIR)).toEqual([])
  })

  //#given unavailable tool and queued operation
  //#when recovery replay succeeds
  //#then tool availability is restored
  it("marks tool available after successful replay", async () => {
    markMcbUnavailable("memory")
    await saveQueue(TEST_DIR, [makeOperation({ tool: "memory" })])

    await attemptRecoverySync(TEST_DIR, async () => {})

    const status = getMcbAvailability()
    expect(status.tools.memory).toBe(true)
  })

  //#given a failing replay
  //#when retry count is still below max
  //#then operation remains queued with incremented retryCount
  it("keeps failed operations with incremented retryCount", async () => {
    await saveQueue(TEST_DIR, [makeOperation({ id: "x", retryCount: 0, maxRetries: 3 })])

    const result = await attemptRecoverySync(TEST_DIR, async () => {
      throw new Error("still down")
    })

    expect(result.replayed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.discarded).toBe(0)
    const queue = await peekQueue(TEST_DIR)
    expect(queue).toHaveLength(1)
    expect(queue[0]?.retryCount).toBe(1)
  })

  //#given a failing replay at max retries
  //#when recovery sync runs
  //#then operation is discarded
  it("discards operations that reached max retries", async () => {
    await saveQueue(TEST_DIR, [makeOperation({ retryCount: 2, maxRetries: 3 })])

    const result = await attemptRecoverySync(TEST_DIR, async () => {
      throw new Error("still down")
    })

    expect(result.failed).toBe(1)
    expect(result.discarded).toBe(1)
    expect(await peekQueue(TEST_DIR)).toEqual([])
  })

  //#given no queued operations
  //#when recovery sync runs
  //#then it is a no-op
  it("returns no-op result for empty queue", async () => {
    const result = await attemptRecoverySync(TEST_DIR, async () => {})
    expect(result).toEqual({ replayed: 0, failed: 0, discarded: 0 })
  })
})

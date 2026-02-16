import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  clearQueue,
  dequeueOperation,
  enqueueOperation,
  evictStaleEntries,
  getQueueSize,
  peekQueue,
  saveQueue,
} from "./sync-queue"
import type { QueuedMcbOperation } from "./sync-queue-types"

const TEST_DIR = join(tmpdir(), `mcb-sync-queue-test-${Date.now()}`)

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

describe("mcb-integration/sync-queue", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  //#given an empty queue
  //#when enqueueOperation is called
  //#then queue size increases
  it("enqueues an operation", async () => {
    await enqueueOperation(TEST_DIR, makeOperation())
    expect(await getQueueSize(TEST_DIR)).toBe(1)
  })

  //#given a queue with one item
  //#when dequeueOperation is called
  //#then the operation is returned and removed
  it("dequeues an operation", async () => {
    const op = makeOperation()
    await enqueueOperation(TEST_DIR, op)
    const dequeued = await dequeueOperation(TEST_DIR)
    expect(dequeued?.id).toBe(op.id)
    expect(await getQueueSize(TEST_DIR)).toBe(0)
  })

  //#given queued operations
  //#when peekQueue is called
  //#then all operations are returned without removal
  it("peeks queue without removing items", async () => {
    await enqueueOperation(TEST_DIR, makeOperation({ id: "a" }))
    await enqueueOperation(TEST_DIR, makeOperation({ id: "b" }))
    const queue = await peekQueue(TEST_DIR)
    expect(queue.map((q) => q.id)).toEqual(["a", "b"])
    expect(await getQueueSize(TEST_DIR)).toBe(2)
  })

  //#given queue entries
  //#when saveQueue is called
  //#then queue file is written atomically
  it("saves queue entries to disk", async () => {
    await saveQueue(TEST_DIR, [makeOperation({ id: "one" })])
    const queuePath = join(TEST_DIR, ".sisyphus", ".mcb-sync-queue.json")
    expect(existsSync(queuePath)).toBe(true)
    const parsed = JSON.parse(readFileSync(queuePath, "utf-8"))
    expect(parsed[0].id).toBe("one")
  })

  //#given a bounded queue config
  //#when enqueueOperation exceeds max entries
  //#then oldest entries are evicted
  it("evicts oldest entries when maxEntries is exceeded", async () => {
    const config = { maxEntries: 2, maxAgeMs: 60_000, queueDir: ".sisyphus", queueFile: ".mcb-sync-queue.json" }
    await enqueueOperation(TEST_DIR, makeOperation({ id: "first" }), config)
    await enqueueOperation(TEST_DIR, makeOperation({ id: "second" }), config)
    await enqueueOperation(TEST_DIR, makeOperation({ id: "third" }), config)
    const queue = await peekQueue(TEST_DIR, config)
    expect(queue.map((q) => q.id)).toEqual(["second", "third"])
  })

  //#given stale and fresh operations
  //#when evictStaleEntries is called
  //#then stale items are removed
  it("evicts stale entries", async () => {
    const now = Date.now()
    const config = { maxEntries: 10, maxAgeMs: 1_000, queueDir: ".sisyphus", queueFile: ".mcb-sync-queue.json" }
    await saveQueue(TEST_DIR, [
      makeOperation({ id: "old", queuedAt: now - 2_000 }),
      makeOperation({ id: "new", queuedAt: now }),
    ], config)
    const evicted = await evictStaleEntries(TEST_DIR, config)
    expect(evicted).toBe(1)
    const queue = await peekQueue(TEST_DIR, config)
    expect(queue.map((q) => q.id)).toEqual(["new"])
  })

  //#given a corrupt queue file
  //#when peekQueue is called
  //#then an empty queue is returned
  it("returns empty queue for corrupt queue file", async () => {
    const queueDir = join(TEST_DIR, ".sisyphus")
    mkdirSync(queueDir, { recursive: true })
    writeFileSync(join(queueDir, ".mcb-sync-queue.json"), "{invalid-json", "utf-8")
    const queue = await peekQueue(TEST_DIR)
    expect(queue).toEqual([])
  })

  //#given queue contents
  //#when clearQueue is called
  //#then queue file is removed
  it("clears queue file", async () => {
    await enqueueOperation(TEST_DIR, makeOperation())
    clearQueue(TEST_DIR)
    const queuePath = join(TEST_DIR, ".sisyphus", ".mcb-sync-queue.json")
    expect(existsSync(queuePath)).toBe(false)
  })
})

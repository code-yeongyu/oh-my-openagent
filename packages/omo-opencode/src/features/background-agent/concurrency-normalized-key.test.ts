import { describe, expect, test } from "bun:test"
import type { BackgroundTaskConfig } from "../../config/schema"
import { ConcurrencyManager } from "./concurrency"

describe("ConcurrencyManager normalized acquire/release keys", () => {
  test("should release a raw model acquisition through the normalized provider key", async () => {
    // given
    const rawModel = "anthropic/claude-sonnet-4-6"
    const config: BackgroundTaskConfig = {
      providerConcurrency: { anthropic: 1 },
    }
    const manager = new ConcurrencyManager(config)
    const normalizedKey = manager.getConcurrencyKey(rawModel)

    // when
    await manager.acquire(rawModel)
    manager.release(normalizedKey)
    const countAfterRelease = manager.getCount(normalizedKey)
    const reacquire = manager.acquire(rawModel, "next-task").then(
      () => "acquired",
      () => "cancelled",
    )
    const countAfterReacquire = manager.getCount(normalizedKey)
    const queueLengthAfterReacquire = manager.getQueueLength(normalizedKey)
    if (queueLengthAfterReacquire > 0) {
      manager.cancelWaiters(normalizedKey)
      await reacquire
    } else if (countAfterReacquire === 0) {
      manager.cancelWaiters(rawModel)
      await reacquire
    }

    // then
    expect(normalizedKey).toBe("anthropic")
    expect(countAfterRelease).toBe(0)
    expect(countAfterReacquire).toBe(1)
    expect(queueLengthAfterReacquire).toBe(0)

    manager.release(normalizedKey)
    await reacquire
  })

  test("should resolve the limit from the raw model before storing by provider key", async () => {
    // given
    const rawModel = "anthropic/claude-sonnet-4-6"
    const config: BackgroundTaskConfig = {
      modelConcurrency: { anthropic: 99 },
      providerConcurrency: { anthropic: 1 },
    }
    const manager = new ConcurrencyManager(config)
    const normalizedKey = manager.getConcurrencyKey(rawModel)
    await manager.acquire(rawModel)

    // when
    const secondAcquire = manager.acquire(rawModel, "second-task").then(
      () => "acquired",
      () => "cancelled",
    )
    const countAfterSecondAcquire = manager.getCount(normalizedKey)
    const queueLengthAfterSecondAcquire = manager.getQueueLength(normalizedKey)

    // then
    expect(normalizedKey).toBe("anthropic")
    expect(countAfterSecondAcquire).toBe(1)
    expect(queueLengthAfterSecondAcquire).toBe(1)

    manager.cancelWaiters(normalizedKey)
    await secondAcquire
    manager.release(normalizedKey)
  })
})

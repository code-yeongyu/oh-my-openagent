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
})

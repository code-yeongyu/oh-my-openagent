import { describe, test, expect, beforeEach } from "bun:test"
import { ConcurrencyManager } from "./concurrency"
import type { BackgroundTaskConfig } from "../../config/schema"

describe("ConcurrencyManager.getConcurrencyLimit", () => {
  test("should return model-specific limit when modelConcurrency is set", () => {
    // #given
    const config: BackgroundTaskConfig = {
      modelConcurrency: { "anthropic/claude-sonnet-4-5": 5 }
    }
    const manager = new ConcurrencyManager(config)

    // #when
    const limit = manager.getConcurrencyLimit("anthropic/claude-sonnet-4-5")

    // #then
    expect(limit).toBe(5)
  })

  test("should return provider limit when providerConcurrency is set for model provider", () => {
    // #given
    const config: BackgroundTaskConfig = {
      providerConcurrency: { anthropic: 3 }
    }
    const manager = new ConcurrencyManager(config)

    // #when
    const limit = manager.getConcurrencyLimit("anthropic/claude-sonnet-4-5")

    // #then
    expect(limit).toBe(3)
  })

  test("should return provider limit even when modelConcurrency exists but doesn't match", () => {
    // #given
    const config: BackgroundTaskConfig = {
      modelConcurrency: { "google/gemini-3-pro": 5 },
      providerConcurrency: { anthropic: 3 }
    }
    const manager = new ConcurrencyManager(config)

    // #when
    const limit = manager.getConcurrencyLimit("anthropic/claude-sonnet-4-5")

    // #then
    expect(limit).toBe(3)
  })

  test("should return default limit when defaultConcurrency is set", () => {
    // #given
    const config: BackgroundTaskConfig = {
      defaultConcurrency: 2
    }
    const manager = new ConcurrencyManager(config)

    // #when
    const limit = manager.getConcurrencyLimit("anthropic/claude-sonnet-4-5")

    // #then
    expect(limit).toBe(2)
  })

  test("should return default 5 when no config provided", () => {
    // #given
    const manager = new ConcurrencyManager()

    // #when
    const limit = manager.getConcurrencyLimit("anthropic/claude-sonnet-4-5")

    // #then
    expect(limit).toBe(5)
  })

  test("should return default 5 when config exists but no concurrency settings", () => {
    // #given
    const config: BackgroundTaskConfig = {}
    const manager = new ConcurrencyManager(config)

    // #when
    const limit = manager.getConcurrencyLimit("anthropic/claude-sonnet-4-5")

    // #then
    expect(limit).toBe(5)
  })

  test("should prioritize model-specific over provider-specific over default", () => {
    // #given
    const config: BackgroundTaskConfig = {
      modelConcurrency: { "anthropic/claude-sonnet-4-5": 10 },
      providerConcurrency: { anthropic: 5 },
      defaultConcurrency: 2
    }
    const manager = new ConcurrencyManager(config)

    // #when
    const modelLimit = manager.getConcurrencyLimit("anthropic/claude-sonnet-4-5")
    const providerLimit = manager.getConcurrencyLimit("anthropic/claude-opus-4-5")
    const defaultLimit = manager.getConcurrencyLimit("google/gemini-3-pro")

    // #then
    expect(modelLimit).toBe(10)
    expect(providerLimit).toBe(5)
    expect(defaultLimit).toBe(2)
  })

  test("should handle models without provider part", () => {
    // #given
    const config: BackgroundTaskConfig = {
      providerConcurrency: { "custom-model": 4 }
    }
    const manager = new ConcurrencyManager(config)

    // #when
    const limit = manager.getConcurrencyLimit("custom-model")

    // #then
    expect(limit).toBe(4)
  })

  test("should return Infinity when defaultConcurrency is 0", () => {
    // #given
    const config: BackgroundTaskConfig = { defaultConcurrency: 0 }
    const manager = new ConcurrencyManager(config)

    // #when
    const limit = manager.getConcurrencyLimit("any-model")

    // #then
    expect(limit).toBe(Infinity)
  })

  test("should return Infinity when providerConcurrency is 0", () => {
    // #given
    const config: BackgroundTaskConfig = {
      providerConcurrency: { anthropic: 0 }
    }
    const manager = new ConcurrencyManager(config)

    // #when
    const limit = manager.getConcurrencyLimit("anthropic/claude-sonnet-4-5")

    // #then
    expect(limit).toBe(Infinity)
  })

  test("should return Infinity when modelConcurrency is 0", () => {
    // #given
    const config: BackgroundTaskConfig = {
      modelConcurrency: { "anthropic/claude-sonnet-4-5": 0 }
    }
    const manager = new ConcurrencyManager(config)

    // #when
    const limit = manager.getConcurrencyLimit("anthropic/claude-sonnet-4-5")

    // #then
    expect(limit).toBe(Infinity)
  })
})

describe("ConcurrencyManager.acquire/release", () => {
  let manager: ConcurrencyManager

  beforeEach(() => {
    // #given
    const config: BackgroundTaskConfig = {}
    manager = new ConcurrencyManager(config)
  })

  test("should allow acquiring up to limit", async () => {
    // #given
    const config: BackgroundTaskConfig = { defaultConcurrency: 2 }
    manager = new ConcurrencyManager(config)

    // #when
    await manager.acquire("model-a")
    await manager.acquire("model-a")

    // #then - both resolved without waiting, count should be 2
    expect(manager.getCount("model-a")).toBe(2)
  })

  test("should allow acquires up to default limit of 5", async () => {
    // #given - no config = default limit of 5

    // #when
    await manager.acquire("model-a")
    await manager.acquire("model-a")
    await manager.acquire("model-a")
    await manager.acquire("model-a")
    await manager.acquire("model-a")

    // #then - all 5 resolved, count should be 5
    expect(manager.getCount("model-a")).toBe(5)
  })

  test("should queue when limit reached", async () => {
    // #given
    const config: BackgroundTaskConfig = { defaultConcurrency: 1 }
    manager = new ConcurrencyManager(config)
    await manager.acquire("model-a")

    // #when
    let resolved = false
    const waitPromise = manager.acquire("model-a").then(() => { resolved = true })

    // Give microtask queue a chance to run
    await Promise.resolve()

    // #then - should still be waiting
    expect(resolved).toBe(false)

    // #when - release
    manager.release("model-a")
    await waitPromise

    // #then - now resolved
    expect(resolved).toBe(true)
  })

  test("should queue multiple tasks and process in order", async () => {
    // #given
    const config: BackgroundTaskConfig = { defaultConcurrency: 1 }
    manager = new ConcurrencyManager(config)
    await manager.acquire("model-a")

    // #when
    const order: string[] = []
    const task1 = manager.acquire("model-a").then(() => { order.push("1") })
    const task2 = manager.acquire("model-a").then(() => { order.push("2") })
    const task3 = manager.acquire("model-a").then(() => { order.push("3") })

    // Give microtask queue a chance to run
    await Promise.resolve()

    // #then - none resolved yet
    expect(order).toEqual([])

    // #when - release one at a time
    manager.release("model-a")
    await task1
    expect(order).toEqual(["1"])

    manager.release("model-a")
    await task2
    expect(order).toEqual(["1", "2"])

    manager.release("model-a")
    await task3
    expect(order).toEqual(["1", "2", "3"])
  })

  test("should handle independent models separately", async () => {
    // #given
    const config: BackgroundTaskConfig = { defaultConcurrency: 1 }
    manager = new ConcurrencyManager(config)
    await manager.acquire("model-a")

    // #when - acquire different model
    const resolved = await Promise.race([
      manager.acquire("model-b").then(() => "resolved"),
      Promise.resolve("timeout").then(() => "timeout")
    ])

    // #then - different model should resolve immediately
    expect(resolved).toBe("resolved")
  })

  test("should allow re-acquiring after release", async () => {
    // #given
    const config: BackgroundTaskConfig = { defaultConcurrency: 1 }
    manager = new ConcurrencyManager(config)

    // #when
    await manager.acquire("model-a")
    manager.release("model-a")
    await manager.acquire("model-a")

    // #then - count should be 1 after re-acquiring
    expect(manager.getCount("model-a")).toBe(1)
  })

  test("should handle release when no acquire", () => {
    // #given
    const config: BackgroundTaskConfig = { defaultConcurrency: 2 }
    manager = new ConcurrencyManager(config)

    // #when - release without acquire
    manager.release("model-a")

    // #then - count should be 0 (no negative count)
    expect(manager.getCount("model-a")).toBe(0)
  })

  test("should handle release when no prior acquire", () => {
    // #given - default config

     // #when - release without acquire
     manager.release("model-a")

     // #then - count should be 0 (no negative count)
     expect(manager.getCount("model-a")).toBe(0)
   })

   test("should handle multiple acquires and releases correctly", async () => {
    // #given
    const config: BackgroundTaskConfig = { defaultConcurrency: 3 }
    manager = new ConcurrencyManager(config)

    // #when
    await manager.acquire("model-a")
    await manager.acquire("model-a")
    await manager.acquire("model-a")

    // Release all
    manager.release("model-a")
    manager.release("model-a")
    manager.release("model-a")

     // Should be able to acquire again
     await manager.acquire("model-a")

     // #then - count should be 1 after re-acquiring
     expect(manager.getCount("model-a")).toBe(1)
  })

  test("should use model-specific limit for acquire", async () => {
    // #given
    const config: BackgroundTaskConfig = {
      modelConcurrency: { "anthropic/claude-sonnet-4-5": 2 },
      defaultConcurrency: 5
    }
    manager = new ConcurrencyManager(config)
    await manager.acquire("anthropic/claude-sonnet-4-5")
    await manager.acquire("anthropic/claude-sonnet-4-5")

    // #when
    let resolved = false
    const waitPromise = manager.acquire("anthropic/claude-sonnet-4-5").then(() => { resolved = true })

    // Give microtask queue a chance to run
    await Promise.resolve()

    // #then - should be waiting (model-specific limit is 2)
    expect(resolved).toBe(false)

    // Cleanup
    manager.release("anthropic/claude-sonnet-4-5")
    await waitPromise
  })
})

describe("ConcurrencyManager.cleanup", () => {
  test("cancelWaiters should reject all pending acquires", async () => {
    // #given
    const config: BackgroundTaskConfig = { defaultConcurrency: 1 }
    const manager = new ConcurrencyManager(config)
    await manager.acquire("model-a")

    // Queue waiters
    const errors: Error[] = []
    const p1 = manager.acquire("model-a").catch(e => errors.push(e))
    const p2 = manager.acquire("model-a").catch(e => errors.push(e))

    // #when
    manager.cancelWaiters("model-a")
    await Promise.all([p1, p2])

    // #then
    expect(errors.length).toBe(2)
    expect(errors[0].message).toContain("cancelled")
  })

  test("clear should cancel all models and reset state", async () => {
    // #given
    const config: BackgroundTaskConfig = { defaultConcurrency: 1 }
    const manager = new ConcurrencyManager(config)
    await manager.acquire("model-a")
    await manager.acquire("model-b")

    const errors: Error[] = []
    const p1 = manager.acquire("model-a").catch(e => errors.push(e))
    const p2 = manager.acquire("model-b").catch(e => errors.push(e))

    // #when
    manager.clear()
    await Promise.all([p1, p2])

    // #then
    expect(errors.length).toBe(2)
    expect(manager.getCount("model-a")).toBe(0)
    expect(manager.getCount("model-b")).toBe(0)
  })

  test("getCount and getQueueLength should return correct values", async () => {
    // #given
    const config: BackgroundTaskConfig = { defaultConcurrency: 2 }
    const manager = new ConcurrencyManager(config)

    // #when
    await manager.acquire("model-a")
    expect(manager.getCount("model-a")).toBe(1)
    expect(manager.getQueueLength("model-a")).toBe(0)

    await manager.acquire("model-a")
    expect(manager.getCount("model-a")).toBe(2)

    // Queue one more
    const p = manager.acquire("model-a").catch(() => {})
    await Promise.resolve() // let it queue

    expect(manager.getQueueLength("model-a")).toBe(1)

    // Cleanup
    manager.cancelWaiters("model-a")
    await p
  })
})

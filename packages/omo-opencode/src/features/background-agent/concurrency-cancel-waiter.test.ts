import { describe, expect, test } from "bun:test"

import type { BackgroundTaskConfig } from "../../config/schema"
import { ConcurrencyManager } from "./concurrency"

describe("ConcurrencyManager.cancelWaiter", () => {
  test("cancelling one task should not affect concurrent tasks on the same model", async () => {
    // given
    const config: BackgroundTaskConfig = { defaultConcurrency: 1 }
    const manager = new ConcurrencyManager(config)
    await manager.acquire("model-a", "running-task")
    let taskAResolved = false
    let taskBResolved = false
    const taskAErrors: Error[] = []
    const pA = manager.acquire("model-a", "task-a")
      .then(() => {
        taskAResolved = true
      })
      .catch((error: Error) => {
        taskAErrors.push(error)
      })
    const pB = manager.acquire("model-a", "task-b").then(() => {
      taskBResolved = true
    })

    await Promise.resolve()

    // when
    const cancelled = manager.cancelWaiter("model-a", "task-a")
    await pA

    // then
    expect(cancelled).toBe(true)
    expect(taskAErrors).toHaveLength(1)
    expect(taskAResolved).toBe(false)
    expect(taskBResolved).toBe(false)
    expect(manager.getQueueLength("model-a")).toBe(1)

    manager.release("model-a")
    await pB
    expect(taskBResolved).toBe(true)
  })
})

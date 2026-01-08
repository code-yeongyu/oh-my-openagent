import { describe, test, expect, beforeEach } from "bun:test"
import type { BackgroundTask } from "./types"

const TASK_TTL_MS = 30 * 60 * 1000

class MockBackgroundManager {
  private tasks: Map<string, BackgroundTask> = new Map()
  private notifications: Map<string, BackgroundTask[]> = new Map()

  addTask(task: BackgroundTask): void {
    this.tasks.set(task.id, task)
  }

  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id)
  }

  getTasksByParentSession(sessionID: string): BackgroundTask[] {
    const result: BackgroundTask[] = []
    for (const task of this.tasks.values()) {
      if (task.parentSessionID === sessionID) {
        result.push(task)
      }
    }
    return result
  }

  getAllDescendantTasks(sessionID: string): BackgroundTask[] {
    const result: BackgroundTask[] = []
    const directChildren = this.getTasksByParentSession(sessionID)

    for (const child of directChildren) {
      result.push(child)
      const descendants = this.getAllDescendantTasks(child.sessionID)
      result.push(...descendants)
    }

    return result
  }

  markForNotification(task: BackgroundTask): void {
    const queue = this.notifications.get(task.parentSessionID) ?? []
    queue.push(task)
    this.notifications.set(task.parentSessionID, queue)
  }

  getPendingNotifications(sessionID: string): BackgroundTask[] {
    return this.notifications.get(sessionID) ?? []
  }

  private clearNotificationsForTask(taskId: string): void {
    for (const [sessionID, tasks] of this.notifications.entries()) {
      const filtered = tasks.filter((t) => t.id !== taskId)
      if (filtered.length === 0) {
        this.notifications.delete(sessionID)
      } else {
        this.notifications.set(sessionID, filtered)
      }
    }
  }

  pruneStaleTasksAndNotifications(): { prunedTasks: string[]; prunedNotifications: number } {
    const now = Date.now()
    const prunedTasks: string[] = []
    let prunedNotifications = 0

    for (const [taskId, task] of this.tasks.entries()) {
      const age = now - task.startedAt.getTime()
      if (age > TASK_TTL_MS) {
        prunedTasks.push(taskId)
        this.clearNotificationsForTask(taskId)
        this.tasks.delete(taskId)
      }
    }

    for (const [sessionID, notifications] of this.notifications.entries()) {
      if (notifications.length === 0) {
        this.notifications.delete(sessionID)
        continue
      }
      const validNotifications = notifications.filter((task) => {
        const age = now - task.startedAt.getTime()
        return age <= TASK_TTL_MS
      })
      const removed = notifications.length - validNotifications.length
      prunedNotifications += removed
      if (validNotifications.length === 0) {
        this.notifications.delete(sessionID)
      } else if (validNotifications.length !== notifications.length) {
        this.notifications.set(sessionID, validNotifications)
      }
    }

    return { prunedTasks, prunedNotifications }
  }

  getTaskCount(): number {
    return this.tasks.size
  }

  getNotificationCount(): number {
    let count = 0
    for (const notifications of this.notifications.values()) {
      count += notifications.length
    }
    return count
  }
}

function createMockTask(overrides: Partial<BackgroundTask> & { id: string; sessionID: string; parentSessionID: string }): BackgroundTask {
  return {
    parentMessageID: "mock-message-id",
    description: "test task",
    prompt: "test prompt",
    agent: "test-agent",
    status: "running",
    startedAt: new Date(),
    ...overrides,
  }
}

describe("BackgroundManager.getAllDescendantTasks", () => {
  let manager: MockBackgroundManager

  beforeEach(() => {
    // #given
    manager = new MockBackgroundManager()
  })

  test("should return empty array when no tasks exist", () => {
    // #given - empty manager

    // #when
    const result = manager.getAllDescendantTasks("session-a")

    // #then
    expect(result).toEqual([])
  })

  test("should return direct children only when no nested tasks", () => {
    // #given
    const taskB = createMockTask({
      id: "task-b",
      sessionID: "session-b",
      parentSessionID: "session-a",
    })
    manager.addTask(taskB)

    // #when
    const result = manager.getAllDescendantTasks("session-a")

    // #then
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("task-b")
  })

  test("should return all nested descendants (2 levels deep)", () => {
    // #given
    // Session A -> Task B -> Task C
    const taskB = createMockTask({
      id: "task-b",
      sessionID: "session-b",
      parentSessionID: "session-a",
    })
    const taskC = createMockTask({
      id: "task-c",
      sessionID: "session-c",
      parentSessionID: "session-b",
    })
    manager.addTask(taskB)
    manager.addTask(taskC)

    // #when
    const result = manager.getAllDescendantTasks("session-a")

    // #then
    expect(result).toHaveLength(2)
    expect(result.map(t => t.id)).toContain("task-b")
    expect(result.map(t => t.id)).toContain("task-c")
  })

  test("should return all nested descendants (3 levels deep)", () => {
    // #given
    // Session A -> Task B -> Task C -> Task D
    const taskB = createMockTask({
      id: "task-b",
      sessionID: "session-b",
      parentSessionID: "session-a",
    })
    const taskC = createMockTask({
      id: "task-c",
      sessionID: "session-c",
      parentSessionID: "session-b",
    })
    const taskD = createMockTask({
      id: "task-d",
      sessionID: "session-d",
      parentSessionID: "session-c",
    })
    manager.addTask(taskB)
    manager.addTask(taskC)
    manager.addTask(taskD)

    // #when
    const result = manager.getAllDescendantTasks("session-a")

    // #then
    expect(result).toHaveLength(3)
    expect(result.map(t => t.id)).toContain("task-b")
    expect(result.map(t => t.id)).toContain("task-c")
    expect(result.map(t => t.id)).toContain("task-d")
  })

  test("should handle multiple branches (tree structure)", () => {
    // #given
    // Session A -> Task B1 -> Task C1
    //           -> Task B2 -> Task C2
    const taskB1 = createMockTask({
      id: "task-b1",
      sessionID: "session-b1",
      parentSessionID: "session-a",
    })
    const taskB2 = createMockTask({
      id: "task-b2",
      sessionID: "session-b2",
      parentSessionID: "session-a",
    })
    const taskC1 = createMockTask({
      id: "task-c1",
      sessionID: "session-c1",
      parentSessionID: "session-b1",
    })
    const taskC2 = createMockTask({
      id: "task-c2",
      sessionID: "session-c2",
      parentSessionID: "session-b2",
    })
    manager.addTask(taskB1)
    manager.addTask(taskB2)
    manager.addTask(taskC1)
    manager.addTask(taskC2)

    // #when
    const result = manager.getAllDescendantTasks("session-a")

    // #then
    expect(result).toHaveLength(4)
    expect(result.map(t => t.id)).toContain("task-b1")
    expect(result.map(t => t.id)).toContain("task-b2")
    expect(result.map(t => t.id)).toContain("task-c1")
    expect(result.map(t => t.id)).toContain("task-c2")
  })

  test("should not include tasks from unrelated sessions", () => {
    // #given
    // Session A -> Task B
    // Session X -> Task Y (unrelated)
    const taskB = createMockTask({
      id: "task-b",
      sessionID: "session-b",
      parentSessionID: "session-a",
    })
    const taskY = createMockTask({
      id: "task-y",
      sessionID: "session-y",
      parentSessionID: "session-x",
    })
    manager.addTask(taskB)
    manager.addTask(taskY)

    // #when
    const result = manager.getAllDescendantTasks("session-a")

    // #then
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("task-b")
    expect(result.map(t => t.id)).not.toContain("task-y")
  })

  test("getTasksByParentSession should only return direct children (not recursive)", () => {
    // #given
    // Session A -> Task B -> Task C
    const taskB = createMockTask({
      id: "task-b",
      sessionID: "session-b",
      parentSessionID: "session-a",
    })
    const taskC = createMockTask({
      id: "task-c",
      sessionID: "session-c",
      parentSessionID: "session-b",
    })
    manager.addTask(taskB)
    manager.addTask(taskC)

    // #when
    const result = manager.getTasksByParentSession("session-a")

    // #then
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("task-b")
  })
})

describe("BackgroundManager.notifyParentSession - release ordering", () => {
  test("should unblock queued task even when prompt hangs", async () => {
    // #given - concurrency limit 1, task1 running, task2 waiting
    const { ConcurrencyManager } = await import("./concurrency")
    const concurrencyManager = new ConcurrencyManager({ defaultConcurrency: 1 })

    await concurrencyManager.acquire("explore")

    let task2Resolved = false
    const task2Promise = concurrencyManager.acquire("explore").then(() => {
      task2Resolved = true
    })

    await Promise.resolve()
    expect(task2Resolved).toBe(false)

    // #when - simulate notifyParentSession: release BEFORE prompt (fixed behavior)
    let promptStarted = false
    const simulateNotifyParentSession = async () => {
      concurrencyManager.release("explore")

      promptStarted = true
      await new Promise(() => {})
    }

    simulateNotifyParentSession()

    await Promise.resolve()
    await Promise.resolve()

    // #then - task2 should be unblocked even though prompt never completes
    expect(promptStarted).toBe(true)
    await task2Promise
    expect(task2Resolved).toBe(true)
  })

  test("should keep queue blocked if release is after prompt (demonstrates the bug)", async () => {
    // #given - same setup
    const { ConcurrencyManager } = await import("./concurrency")
    const concurrencyManager = new ConcurrencyManager({ defaultConcurrency: 1 })

    await concurrencyManager.acquire("explore")

    let task2Resolved = false
    concurrencyManager.acquire("explore").then(() => {
      task2Resolved = true
    })

    await Promise.resolve()
    expect(task2Resolved).toBe(false)

    // #when - simulate BUGGY behavior: release AFTER prompt (in finally)
    const simulateBuggyNotifyParentSession = async () => {
      try {
        await new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 50))
      } finally {
        concurrencyManager.release("explore")
      }
    }

    await simulateBuggyNotifyParentSession().catch(() => {})

    // #then - task2 resolves only after prompt completes (blocked during hang)
    await Promise.resolve()
    expect(task2Resolved).toBe(true)
  })
})

describe("BackgroundManager.pollRunningTasks - stability detection", () => {
  const MIN_STABILITY_TIME_MS = 10000 // Must match the constant in manager.ts

  /**
   * Simulates the stability detection logic from pollRunningTasks.
   * This mirrors the actual implementation to test the algorithm in isolation.
   */
  function simulateStabilityCheck(
    task: BackgroundTask,
    currentMsgCount: number,
    elapsedMs: number
  ): { shouldComplete: boolean; stableCount: number } {
    const progress = task.progress!

    if (progress.lastMsgCount === currentMsgCount && elapsedMs >= MIN_STABILITY_TIME_MS) {
      progress.stableCount = (progress.stableCount ?? 0) + 1
      if (progress.stableCount >= 3) {
        return { shouldComplete: true, stableCount: progress.stableCount }
      }
    } else {
      progress.stableCount = 0
    }
    progress.lastMsgCount = currentMsgCount

    return { shouldComplete: false, stableCount: progress.stableCount ?? 0 }
  }

  test("should complete task after 3 stable polls with messages", () => {
    // #given - task running for 15 seconds with stable message count
    const task = createMockTask({
      id: "task-stable",
      sessionID: "session-stable",
      parentSessionID: "session-parent",
      startedAt: new Date(Date.now() - 15000), // 15 seconds ago
      progress: { toolCalls: 5, lastUpdate: new Date() },
    })

    // #when - simulate polls with same message count
    // Note: First poll sets lastMsgCount, stability counting starts from second poll
    const elapsedMs = 15000
    const msgCount = 10

    // Poll 1 - sets lastMsgCount, stableCount stays 0
    let result = simulateStabilityCheck(task, msgCount, elapsedMs)
    expect(result.shouldComplete).toBe(false)
    expect(result.stableCount).toBe(0) // First poll: lastMsgCount was undefined

    // Poll 2 - first stable poll
    result = simulateStabilityCheck(task, msgCount, elapsedMs + 2000)
    expect(result.shouldComplete).toBe(false)
    expect(result.stableCount).toBe(1)

    // Poll 3 - second stable poll
    result = simulateStabilityCheck(task, msgCount, elapsedMs + 4000)
    expect(result.shouldComplete).toBe(false)
    expect(result.stableCount).toBe(2)

    // Poll 4 - third stable poll
    result = simulateStabilityCheck(task, msgCount, elapsedMs + 6000)

    // #then - task should complete after 3 stable polls
    expect(result.shouldComplete).toBe(true)
    expect(result.stableCount).toBe(3)
  })

  test("should not prematurely complete slow-starting tasks (before MIN_STABILITY_TIME_MS)", () => {
    // #given - task just started (only 5 seconds elapsed, below 10s threshold)
    const task = createMockTask({
      id: "task-new",
      sessionID: "session-new",
      parentSessionID: "session-parent",
      startedAt: new Date(Date.now() - 5000), // 5 seconds ago
      progress: { toolCalls: 0, lastUpdate: new Date() },
    })

    // #when - simulate 5 polls with 0 messages (task still initializing)
    const elapsedMs = 5000 // Below MIN_STABILITY_TIME_MS threshold
    const msgCount = 0

    for (let i = 0; i < 5; i++) {
      const result = simulateStabilityCheck(task, msgCount, elapsedMs)
      // #then - should never complete because elapsed time is below threshold
      expect(result.shouldComplete).toBe(false)
    }

    // Stability counter should remain at 0 because elapsed < MIN_STABILITY_TIME_MS
    expect(task.progress!.stableCount).toBe(0)
  })

  test("should handle tasks that complete with 0 messages after MIN_STABILITY_TIME_MS", () => {
    // #given - task running for 15 seconds but no messages (error case or instant completion)
    const task = createMockTask({
      id: "task-zero-msgs",
      sessionID: "session-zero",
      parentSessionID: "session-parent",
      startedAt: new Date(Date.now() - 15000), // 15 seconds ago
      progress: { toolCalls: 0, lastUpdate: new Date() },
    })

    // #when - simulate 4 polls with 0 messages after min time elapsed
    // Note: First poll sets lastMsgCount, stability counting starts from second poll
    const elapsedMs = 15000
    const msgCount = 0

    // Poll 1 - sets lastMsgCount
    let result = simulateStabilityCheck(task, msgCount, elapsedMs)
    expect(result.stableCount).toBe(0)

    // Poll 2-4 - stable polls
    result = simulateStabilityCheck(task, msgCount, elapsedMs + 2000)
    expect(result.stableCount).toBe(1)

    result = simulateStabilityCheck(task, msgCount, elapsedMs + 4000)
    expect(result.stableCount).toBe(2)

    result = simulateStabilityCheck(task, msgCount, elapsedMs + 6000)

    // #then - task should complete even with 0 messages (this was the bug fix!)
    expect(result.shouldComplete).toBe(true)
    expect(result.stableCount).toBe(3)
  })

  test("should reset stability counter when message count changes", () => {
    // #given - task running for 20 seconds
    const task = createMockTask({
      id: "task-active",
      sessionID: "session-active",
      parentSessionID: "session-parent",
      startedAt: new Date(Date.now() - 20000), // 20 seconds ago
      progress: { toolCalls: 3, lastUpdate: new Date() },
    })

    const elapsedMs = 20000

    // #when - poll with 5 messages (first sets baseline), then 5 again, then 7 (changed)
    // Poll 1 - sets lastMsgCount
    simulateStabilityCheck(task, 5, elapsedMs)
    expect(task.progress!.stableCount).toBe(0)

    // Poll 2 - stable
    let result = simulateStabilityCheck(task, 5, elapsedMs + 2000)
    expect(result.stableCount).toBe(1)

    // Poll 3 - Message count changes - new activity detected
    result = simulateStabilityCheck(task, 7, elapsedMs + 4000)

    // #then - stability counter should reset to 0
    expect(result.stableCount).toBe(0)
    expect(result.shouldComplete).toBe(false)
  })

  test("should require exactly 3 stable polls to complete", () => {
    // #given
    const task = createMockTask({
      id: "task-threshold",
      sessionID: "session-threshold",
      parentSessionID: "session-parent",
      startedAt: new Date(Date.now() - 20000),
      progress: { toolCalls: 2, lastUpdate: new Date() },
    })

    const elapsedMs = 20000
    const msgCount = 8

    // #when - poll 3 times (first sets baseline, next 2 are stable but not enough)
    // Poll 1 - sets lastMsgCount
    let result = simulateStabilityCheck(task, msgCount, elapsedMs)
    expect(result.shouldComplete).toBe(false)
    expect(result.stableCount).toBe(0)

    // Poll 2 - first stable
    result = simulateStabilityCheck(task, msgCount, elapsedMs + 2000)
    expect(result.shouldComplete).toBe(false)
    expect(result.stableCount).toBe(1)

    // Poll 3 - second stable
    result = simulateStabilityCheck(task, msgCount, elapsedMs + 4000)
    // #then - should NOT complete after only 2 stable polls
    expect(result.shouldComplete).toBe(false)
    expect(result.stableCount).toBe(2)

    // Poll 4 - third stable
    result = simulateStabilityCheck(task, msgCount, elapsedMs + 6000)

    // Now it should complete
    expect(result.shouldComplete).toBe(true)
    expect(result.stableCount).toBe(3)
  })

  test("should handle edge case: stability resets then builds up again", () => {
    // #given
    const task = createMockTask({
      id: "task-intermittent",
      sessionID: "session-intermittent",
      parentSessionID: "session-parent",
      startedAt: new Date(Date.now() - 30000),
      progress: { toolCalls: 1, lastUpdate: new Date() },
    })

    const elapsedMs = 30000

    // #when - set baseline, build up to 2, then reset, then build to 3
    // Poll 1 - sets lastMsgCount
    simulateStabilityCheck(task, 3, elapsedMs)
    expect(task.progress!.stableCount).toBe(0)

    // Poll 2-3 - build stability
    simulateStabilityCheck(task, 3, elapsedMs + 2000)
    expect(task.progress!.stableCount).toBe(1)

    simulateStabilityCheck(task, 3, elapsedMs + 4000)
    expect(task.progress!.stableCount).toBe(2)

    // Poll 4 - Activity detected - reset
    simulateStabilityCheck(task, 5, elapsedMs + 6000)
    expect(task.progress!.stableCount).toBe(0)

    // Poll 5-7 - Build up again (first sets baseline, next 3 are stable)
    simulateStabilityCheck(task, 5, elapsedMs + 8000)
    expect(task.progress!.stableCount).toBe(1)

    simulateStabilityCheck(task, 5, elapsedMs + 10000)
    expect(task.progress!.stableCount).toBe(2)

    const result = simulateStabilityCheck(task, 5, elapsedMs + 12000)

    // #then - should complete after 3 new stable polls
    expect(result.shouldComplete).toBe(true)
    expect(result.stableCount).toBe(3)
  })
})

describe("BackgroundManager.pruneStaleTasksAndNotifications", () => {
  let manager: MockBackgroundManager

  beforeEach(() => {
    // #given
    manager = new MockBackgroundManager()
  })

  test("should not prune fresh tasks", () => {
    // #given
    const task = createMockTask({
      id: "task-fresh",
      sessionID: "session-fresh",
      parentSessionID: "session-parent",
      startedAt: new Date(),
    })
    manager.addTask(task)

    // #when
    const result = manager.pruneStaleTasksAndNotifications()

    // #then
    expect(result.prunedTasks).toHaveLength(0)
    expect(manager.getTaskCount()).toBe(1)
  })

  test("should prune tasks older than 30 minutes", () => {
    // #given
    const staleDate = new Date(Date.now() - 31 * 60 * 1000)
    const task = createMockTask({
      id: "task-stale",
      sessionID: "session-stale",
      parentSessionID: "session-parent",
      startedAt: staleDate,
    })
    manager.addTask(task)

    // #when
    const result = manager.pruneStaleTasksAndNotifications()

    // #then
    expect(result.prunedTasks).toContain("task-stale")
    expect(manager.getTaskCount()).toBe(0)
  })

  test("should prune stale notifications", () => {
    // #given
    const staleDate = new Date(Date.now() - 31 * 60 * 1000)
    const task = createMockTask({
      id: "task-stale",
      sessionID: "session-stale",
      parentSessionID: "session-parent",
      startedAt: staleDate,
    })
    manager.markForNotification(task)

    // #when
    const result = manager.pruneStaleTasksAndNotifications()

    // #then
    expect(result.prunedNotifications).toBe(1)
    expect(manager.getNotificationCount()).toBe(0)
  })

  test("should clean up notifications when task is pruned", () => {
    // #given
    const staleDate = new Date(Date.now() - 31 * 60 * 1000)
    const task = createMockTask({
      id: "task-stale",
      sessionID: "session-stale",
      parentSessionID: "session-parent",
      startedAt: staleDate,
    })
    manager.addTask(task)
    manager.markForNotification(task)

    // #when
    manager.pruneStaleTasksAndNotifications()

    // #then
    expect(manager.getTaskCount()).toBe(0)
    expect(manager.getNotificationCount()).toBe(0)
  })

  test("should keep fresh tasks while pruning stale ones", () => {
    // #given
    const staleDate = new Date(Date.now() - 31 * 60 * 1000)
    const staleTask = createMockTask({
      id: "task-stale",
      sessionID: "session-stale",
      parentSessionID: "session-parent",
      startedAt: staleDate,
    })
    const freshTask = createMockTask({
      id: "task-fresh",
      sessionID: "session-fresh",
      parentSessionID: "session-parent",
      startedAt: new Date(),
    })
    manager.addTask(staleTask)
    manager.addTask(freshTask)

    // #when
    const result = manager.pruneStaleTasksAndNotifications()

    // #then
    expect(result.prunedTasks).toHaveLength(1)
    expect(result.prunedTasks).toContain("task-stale")
    expect(manager.getTaskCount()).toBe(1)
    expect(manager.getTask("task-fresh")).toBeDefined()
  })
})

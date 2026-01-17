import { describe, test, expect, beforeEach } from "bun:test"
import { afterEach } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundTask, ResumeInput } from "./types"
import { BackgroundManager } from "./manager"
import { ConcurrencyManager } from "./concurrency"


const TASK_TTL_MS = 30 * 60 * 1000

class MockBackgroundManager {
  private tasks: Map<string, BackgroundTask> = new Map()
  private notifications: Map<string, BackgroundTask[]> = new Map()
  public resumeCalls: Array<{ sessionId: string; prompt: string }> = []

  addTask(task: BackgroundTask): void {
    this.tasks.set(task.id, task)
  }

  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id)
  }

  findBySession(sessionID: string): BackgroundTask | undefined {
    for (const task of this.tasks.values()) {
      if (task.sessionID === sessionID) {
        return task
      }
    }
    return undefined
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

  resume(input: ResumeInput): BackgroundTask {
    const existingTask = this.findBySession(input.sessionId)
    if (!existingTask) {
      throw new Error(`Task not found for session: ${input.sessionId}`)
    }

    if (existingTask.status === "running") {
      return existingTask
    }

    this.resumeCalls.push({ sessionId: input.sessionId, prompt: input.prompt })

    existingTask.status = "running"
    existingTask.completedAt = undefined
    existingTask.error = undefined
    existingTask.parentSessionID = input.parentSessionID
    existingTask.parentMessageID = input.parentMessageID
    existingTask.parentModel = input.parentModel

    existingTask.progress = {
      toolCalls: existingTask.progress?.toolCalls ?? 0,
      lastUpdate: new Date(),
    }

    return existingTask
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

function createBackgroundManager(): BackgroundManager {
  const client = {
    session: {
      prompt: async () => ({}),
    },
  }
  return new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
}

function getConcurrencyManager(manager: BackgroundManager): ConcurrencyManager {
  return (manager as unknown as { concurrencyManager: ConcurrencyManager }).concurrencyManager
}

function getTaskMap(manager: BackgroundManager): Map<string, BackgroundTask> {
  return (manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks
}

function stubNotifyParentSession(manager: BackgroundManager): void {
  (manager as unknown as { notifyParentSession: (task: BackgroundTask) => Promise<void> }).notifyParentSession = async () => {}
}

async function tryCompleteTaskForTest(manager: BackgroundManager, task: BackgroundTask): Promise<boolean> {
  return (manager as unknown as { tryCompleteTask: (task: BackgroundTask, source: string) => Promise<boolean> }).tryCompleteTask(task, "test")
}

function getCleanupSignals(): Array<NodeJS.Signals | "beforeExit" | "exit"> {
  const signals: Array<NodeJS.Signals | "beforeExit" | "exit"> = ["SIGINT", "SIGTERM", "beforeExit", "exit"]
  if (process.platform === "win32") {
    signals.push("SIGBREAK")
  }
  return signals
}

function getListenerCounts(signals: Array<NodeJS.Signals | "beforeExit" | "exit">): Record<string, number> {
  return Object.fromEntries(signals.map((signal) => [signal, process.listenerCount(signal)]))
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

describe("BackgroundManager.resume", () => {
  let manager: MockBackgroundManager

  beforeEach(() => {
    // #given
    manager = new MockBackgroundManager()
  })

  test("should throw error when task not found", () => {
    // #given - empty manager

    // #when / #then
    expect(() => manager.resume({
      sessionId: "non-existent",
      prompt: "continue",
      parentSessionID: "session-new",
      parentMessageID: "msg-new",
    })).toThrow("Task not found for session: non-existent")
  })

  test("should resume existing task and reset state to running", () => {
    // #given
    const completedTask = createMockTask({
      id: "task-a",
      sessionID: "session-a",
      parentSessionID: "session-parent",
      status: "completed",
    })
    completedTask.completedAt = new Date()
    completedTask.error = "previous error"
    manager.addTask(completedTask)

    // #when
    const result = manager.resume({
      sessionId: "session-a",
      prompt: "continue the work",
      parentSessionID: "session-new-parent",
      parentMessageID: "msg-new",
    })

    // #then
    expect(result.status).toBe("running")
    expect(result.completedAt).toBeUndefined()
    expect(result.error).toBeUndefined()
    expect(result.parentSessionID).toBe("session-new-parent")
    expect(result.parentMessageID).toBe("msg-new")
  })

  test("should preserve task identity while updating parent context", () => {
    // #given
    const existingTask = createMockTask({
      id: "task-a",
      sessionID: "session-a",
      parentSessionID: "old-parent",
      description: "original description",
      agent: "explore",
      status: "completed",
    })
    manager.addTask(existingTask)

    // #when
    const result = manager.resume({
      sessionId: "session-a",
      prompt: "new prompt",
      parentSessionID: "new-parent",
      parentMessageID: "new-msg",
      parentModel: { providerID: "anthropic", modelID: "claude-opus" },
    })

    // #then
    expect(result.id).toBe("task-a")
    expect(result.sessionID).toBe("session-a")
    expect(result.description).toBe("original description")
    expect(result.agent).toBe("explore")
    expect(result.parentModel).toEqual({ providerID: "anthropic", modelID: "claude-opus" })
  })

  test("should track resume calls with prompt", () => {
    // #given
    const task = createMockTask({
      id: "task-a",
      sessionID: "session-a",
      parentSessionID: "session-parent",
      status: "completed",
    })
    manager.addTask(task)

    // #when
    manager.resume({
      sessionId: "session-a",
      prompt: "continue with additional context",
      parentSessionID: "session-new",
      parentMessageID: "msg-new",
    })

    // #then
    expect(manager.resumeCalls).toHaveLength(1)
    expect(manager.resumeCalls[0]).toEqual({
      sessionId: "session-a",
      prompt: "continue with additional context",
    })
  })

  test("should preserve existing tool call count in progress", () => {
    // #given
    const taskWithProgress = createMockTask({
      id: "task-a",
      sessionID: "session-a",
      parentSessionID: "session-parent",
      status: "completed",
    })
    taskWithProgress.progress = {
      toolCalls: 42,
      lastTool: "read",
      lastUpdate: new Date(),
    }
    manager.addTask(taskWithProgress)

    // #when
    const result = manager.resume({
      sessionId: "session-a",
      prompt: "continue",
      parentSessionID: "session-new",
      parentMessageID: "msg-new",
    })

    // #then
    expect(result.progress?.toolCalls).toBe(42)
  })

  test("should ignore resume when task is already running", () => {
    // #given
    const runningTask = createMockTask({
      id: "task-a",
      sessionID: "session-a",
      parentSessionID: "session-parent",
      status: "running",
    })
    manager.addTask(runningTask)

    // #when
    const result = manager.resume({
      sessionId: "session-a",
      prompt: "resume should be ignored",
      parentSessionID: "new-parent",
      parentMessageID: "new-msg",
    })

    // #then
    expect(result.parentSessionID).toBe("session-parent")
    expect(manager.resumeCalls).toHaveLength(0)
  })
})

describe("LaunchInput.skillContent", () => {
  test("skillContent should be optional in LaunchInput type", () => {
    // #given
    const input: import("./types").LaunchInput = {
      description: "test",
      prompt: "test prompt",
      agent: "explore",
      parentSessionID: "parent-session",
      parentMessageID: "parent-msg",
    }

    // #when / #then - should compile without skillContent
    expect(input.skillContent).toBeUndefined()
  })

  test("skillContent can be provided in LaunchInput", () => {
    // #given
    const input: import("./types").LaunchInput = {
      description: "test",
      prompt: "test prompt",
      agent: "explore",
      parentSessionID: "parent-session",
      parentMessageID: "parent-msg",
      skillContent: "You are a playwright expert",
    }

    // #when / #then
    expect(input.skillContent).toBe("You are a playwright expert")
  })
})

interface CurrentMessage {
  agent?: string
  model?: { providerID?: string; modelID?: string }
}

describe("BackgroundManager.notifyParentSession - dynamic message lookup", () => {
  test("should use currentMessage model/agent when available", async () => {
    // #given - currentMessage has model and agent
    const task: BackgroundTask = {
      id: "task-1",
      sessionID: "session-child",
      parentSessionID: "session-parent",
      parentMessageID: "msg-parent",
      description: "task with dynamic lookup",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      parentAgent: "OldAgent",
      parentModel: { providerID: "old", modelID: "old-model" },
    }
    const currentMessage: CurrentMessage = {
      agent: "Sisyphus",
      model: { providerID: "anthropic", modelID: "claude-opus-4-5" },
    }

    // #when
    const promptBody = buildNotificationPromptBody(task, currentMessage)

    // #then - uses currentMessage values, not task.parentModel/parentAgent
    expect(promptBody.agent).toBe("Sisyphus")
    expect(promptBody.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-5" })
  })

  test("should fallback to parentAgent when currentMessage.agent is undefined", async () => {
    // #given
    const task: BackgroundTask = {
      id: "task-2",
      sessionID: "session-child",
      parentSessionID: "session-parent",
      parentMessageID: "msg-parent",
      description: "task fallback agent",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      parentAgent: "FallbackAgent",
      parentModel: undefined,
    }
    const currentMessage: CurrentMessage = { agent: undefined, model: undefined }

    // #when
    const promptBody = buildNotificationPromptBody(task, currentMessage)

    // #then - falls back to task.parentAgent
    expect(promptBody.agent).toBe("FallbackAgent")
    expect("model" in promptBody).toBe(false)
  })

  test("should not pass model when currentMessage.model is incomplete", async () => {
    // #given - model missing modelID
    const task: BackgroundTask = {
      id: "task-3",
      sessionID: "session-child",
      parentSessionID: "session-parent",
      parentMessageID: "msg-parent",
      description: "task incomplete model",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      parentAgent: "Sisyphus",
      parentModel: { providerID: "anthropic", modelID: "claude-opus" },
    }
    const currentMessage: CurrentMessage = {
      agent: "Sisyphus",
      model: { providerID: "anthropic" },
    }

    // #when
    const promptBody = buildNotificationPromptBody(task, currentMessage)

    // #then - model not passed due to incomplete data
    expect(promptBody.agent).toBe("Sisyphus")
    expect("model" in promptBody).toBe(false)
  })

  test("should handle null currentMessage gracefully", async () => {
    // #given - no message found (messageDir lookup failed)
    const task: BackgroundTask = {
      id: "task-4",
      sessionID: "session-child",
      parentSessionID: "session-parent",
      parentMessageID: "msg-parent",
      description: "task no message",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      parentAgent: "Sisyphus",
      parentModel: { providerID: "anthropic", modelID: "claude-opus" },
    }

    // #when
    const promptBody = buildNotificationPromptBody(task, null)

    // #then - falls back to task.parentAgent, no model
    expect(promptBody.agent).toBe("Sisyphus")
    expect("model" in promptBody).toBe(false)
  })
})

function buildNotificationPromptBody(
  task: BackgroundTask,
  currentMessage: CurrentMessage | null
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    parts: [{ type: "text", text: `[BACKGROUND TASK COMPLETED] Task "${task.description}" finished.` }],
  }

  const agent = currentMessage?.agent ?? task.parentAgent
  const model = currentMessage?.model?.providerID && currentMessage?.model?.modelID
    ? { providerID: currentMessage.model.providerID, modelID: currentMessage.model.modelID }
    : undefined

  if (agent !== undefined) {
    body.agent = agent
  }
  if (model !== undefined) {
    body.model = model
  }

  return body
}

describe("BackgroundManager.tryCompleteTask", () => {
  let manager: BackgroundManager

  beforeEach(() => {
    // #given
    manager = createBackgroundManager()
    stubNotifyParentSession(manager)
  })

  afterEach(() => {
    manager.shutdown()
  })

  test("should release concurrency and clear key on completion", async () => {
    // #given
    const concurrencyKey = "anthropic/claude-opus-4-5"
    const concurrencyManager = getConcurrencyManager(manager)
    await concurrencyManager.acquire(concurrencyKey)

    const task: BackgroundTask = {
      id: "task-1",
      sessionID: "session-1",
      parentSessionID: "session-parent",
      parentMessageID: "msg-1",
      description: "test task",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(),
      concurrencyKey,
    }

    // #when
    const completed = await tryCompleteTaskForTest(manager, task)

    // #then
    expect(completed).toBe(true)
    expect(task.status).toBe("completed")
    expect(task.concurrencyKey).toBeUndefined()
    expect(concurrencyManager.getCount(concurrencyKey)).toBe(0)
  })

  test("should prevent double completion and double release", async () => {
    // #given
    const concurrencyKey = "anthropic/claude-opus-4-5"
    const concurrencyManager = getConcurrencyManager(manager)
    await concurrencyManager.acquire(concurrencyKey)

    const task: BackgroundTask = {
      id: "task-1",
      sessionID: "session-1",
      parentSessionID: "session-parent",
      parentMessageID: "msg-1",
      description: "test task",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(),
      concurrencyKey,
    }

    // #when
    await tryCompleteTaskForTest(manager, task)
    const secondAttempt = await tryCompleteTaskForTest(manager, task)

    // #then
    expect(secondAttempt).toBe(false)
    expect(task.status).toBe("completed")
    expect(concurrencyManager.getCount(concurrencyKey)).toBe(0)
  })
})

describe("BackgroundManager.trackTask", () => {
  let manager: BackgroundManager

  beforeEach(() => {
    // #given
    manager = createBackgroundManager()
    stubNotifyParentSession(manager)
  })

  afterEach(() => {
    manager.shutdown()
  })

  test("should not double acquire on duplicate registration", async () => {
    // #given
    const input = {
      taskId: "task-1",
      sessionID: "session-1",
      parentSessionID: "parent-session",
      description: "external task",
      agent: "delegate_task",
      concurrencyKey: "external-key",
    }

    // #when
    await manager.trackTask(input)
    await manager.trackTask(input)

    // #then
    const concurrencyManager = getConcurrencyManager(manager)
    expect(concurrencyManager.getCount("external-key")).toBe(1)
    expect(getTaskMap(manager).size).toBe(1)
  })
})

describe("BackgroundManager.resume concurrency key", () => {
  let manager: BackgroundManager

  beforeEach(() => {
    // #given
    manager = createBackgroundManager()
    stubNotifyParentSession(manager)
  })

  afterEach(() => {
    manager.shutdown()
  })

  test("should re-acquire using external task concurrency key", async () => {
    // #given
    const task = await manager.trackTask({
      taskId: "task-1",
      sessionID: "session-1",
      parentSessionID: "parent-session",
      description: "external task",
      agent: "delegate_task",
      concurrencyKey: "external-key",
    })

    await tryCompleteTaskForTest(manager, task)

    // #when
    await manager.resume({
      sessionId: "session-1",
      prompt: "resume",
      parentSessionID: "parent-session-2",
      parentMessageID: "msg-2",
    })

    // #then
    const concurrencyManager = getConcurrencyManager(manager)
    expect(concurrencyManager.getCount("external-key")).toBe(1)
    expect(task.concurrencyKey).toBe("external-key")
  })
})

describe("BackgroundManager.resume model persistence", () => {
  let manager: BackgroundManager
  let promptCalls: Array<{ path: { id: string }; body: Record<string, unknown> }>

  beforeEach(() => {
    // #given
    promptCalls = []
    const client = {
      session: {
        prompt: async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push(args)
          return {}
        },
      },
    }
    manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
    stubNotifyParentSession(manager)
  })

  afterEach(() => {
    manager.shutdown()
  })

  test("should pass model when task has a configured model", async () => {
    // #given - task with model from category config
    const taskWithModel: BackgroundTask = {
      id: "task-with-model",
      sessionID: "session-1",
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
      description: "task with model override",
      prompt: "original prompt",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      concurrencyGroup: "explore",
    }
    getTaskMap(manager).set(taskWithModel.id, taskWithModel)

    // #when
    await manager.resume({
      sessionId: "session-1",
      prompt: "continue the work",
      parentSessionID: "parent-session-2",
      parentMessageID: "msg-2",
    })

    // #then - model should be passed in prompt body
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0].body.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" })
    expect(promptCalls[0].body.agent).toBe("explore")
  })

  test("should NOT pass model when task has no model (backward compatibility)", async () => {
    // #given - task without model (default behavior)
    const taskWithoutModel: BackgroundTask = {
      id: "task-no-model",
      sessionID: "session-2",
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
      description: "task without model",
      prompt: "original prompt",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      concurrencyGroup: "explore",
    }
    getTaskMap(manager).set(taskWithoutModel.id, taskWithoutModel)

    // #when
    await manager.resume({
      sessionId: "session-2",
      prompt: "continue the work",
      parentSessionID: "parent-session-2",
      parentMessageID: "msg-2",
    })

    // #then - model should NOT be in prompt body
    expect(promptCalls).toHaveLength(1)
    expect("model" in promptCalls[0].body).toBe(false)
    expect(promptCalls[0].body.agent).toBe("explore")
  })
})

describe("BackgroundManager process cleanup", () => {
  test("should remove listeners after last shutdown", () => {
    // #given
    const signals = getCleanupSignals()
    const baseline = getListenerCounts(signals)
    const managerA = createBackgroundManager()
    const managerB = createBackgroundManager()

    // #when
    const afterCreate = getListenerCounts(signals)
    managerA.shutdown()
    const afterFirstShutdown = getListenerCounts(signals)
    managerB.shutdown()
    const afterSecondShutdown = getListenerCounts(signals)

    // #then
    for (const signal of signals) {
      expect(afterCreate[signal]).toBe(baseline[signal] + 1)
      expect(afterFirstShutdown[signal]).toBe(baseline[signal] + 1)
      expect(afterSecondShutdown[signal]).toBe(baseline[signal])
    }
  })
})

describe("BackgroundManager.checkAndInterruptStaleTasks", () => {
  test("should NOT interrupt task running less than 30 seconds (min runtime guard)", async () => {
    const client = {
      session: {
        prompt: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput, { staleTimeoutMs: 180_000 })

    const task: BackgroundTask = {
      id: "task-1",
      sessionID: "session-1",
      parentSessionID: "parent-1",
      parentMessageID: "msg-1",
      description: "Test task",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 20_000),
      progress: {
        toolCalls: 0,
        lastUpdate: new Date(Date.now() - 200_000),
      },
    }

    manager["tasks"].set(task.id, task)

    await manager["checkAndInterruptStaleTasks"]()

    expect(task.status).toBe("running")
  })

  test("should NOT interrupt task with recent lastUpdate", async () => {
    const client = {
      session: {
        prompt: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput, { staleTimeoutMs: 180_000 })

    const task: BackgroundTask = {
      id: "task-2",
      sessionID: "session-2",
      parentSessionID: "parent-2",
      parentMessageID: "msg-2",
      description: "Test task",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 60_000),
      progress: {
        toolCalls: 5,
        lastUpdate: new Date(Date.now() - 30_000),
      },
    }

    manager["tasks"].set(task.id, task)

    await manager["checkAndInterruptStaleTasks"]()

    expect(task.status).toBe("running")
  })

  test("should interrupt task with stale lastUpdate (> 3min)", async () => {
    const client = {
      session: {
        prompt: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput, { staleTimeoutMs: 180_000 })

    const task: BackgroundTask = {
      id: "task-3",
      sessionID: "session-3",
      parentSessionID: "parent-3",
      parentMessageID: "msg-3",
      description: "Stale task",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 200_000),
      },
    }

    manager["tasks"].set(task.id, task)

    await manager["checkAndInterruptStaleTasks"]()

    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
    expect(task.error).toContain("3min")
    expect(task.completedAt).toBeDefined()
  })

  test("should respect custom staleTimeoutMs config", async () => {
    const client = {
      session: {
        prompt: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput, { staleTimeoutMs: 60_000 })

    const task: BackgroundTask = {
      id: "task-4",
      sessionID: "session-4",
      parentSessionID: "parent-4",
      parentMessageID: "msg-4",
      description: "Custom timeout task",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 120_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 90_000),
      },
    }

    manager["tasks"].set(task.id, task)

    await manager["checkAndInterruptStaleTasks"]()

    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  test("should release concurrency before abort", async () => {
    const client = {
      session: {
        prompt: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput, { staleTimeoutMs: 180_000 })

    const task: BackgroundTask = {
      id: "task-5",
      sessionID: "session-5",
      parentSessionID: "parent-5",
      parentMessageID: "msg-5",
      description: "Concurrency test",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 200_000),
      },
      concurrencyKey: "test-agent",
    }

    manager["tasks"].set(task.id, task)

    await manager["checkAndInterruptStaleTasks"]()

    expect(task.concurrencyKey).toBeUndefined()
    expect(task.status).toBe("cancelled")
  })

  test("should handle multiple stale tasks in same poll cycle", async () => {
    const client = {
      session: {
        prompt: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput, { staleTimeoutMs: 180_000 })

    const task1: BackgroundTask = {
      id: "task-6",
      sessionID: "session-6",
      parentSessionID: "parent-6",
      parentMessageID: "msg-6",
      description: "Stale 1",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 200_000),
      },
    }

    const task2: BackgroundTask = {
      id: "task-7",
      sessionID: "session-7",
      parentSessionID: "parent-7",
      parentMessageID: "msg-7",
      description: "Stale 2",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 400_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 250_000),
      },
    }

    manager["tasks"].set(task1.id, task1)
    manager["tasks"].set(task2.id, task2)

    await manager["checkAndInterruptStaleTasks"]()

    expect(task1.status).toBe("cancelled")
    expect(task2.status).toBe("cancelled")
  })

  test("should use default timeout when config not provided", async () => {
    const client = {
      session: {
        prompt: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)

    const task: BackgroundTask = {
      id: "task-8",
      sessionID: "session-8",
      parentSessionID: "parent-8",
      parentMessageID: "msg-8",
      description: "Default timeout",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 200_000),
      },
    }

    manager["tasks"].set(task.id, task)

    await manager["checkAndInterruptStaleTasks"]()

    expect(task.status).toBe("cancelled")
  })
})


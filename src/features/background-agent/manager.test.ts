declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach, afterAll, spyOn, mock } = require("bun:test")

afterAll(() => { mock.restore() })

import { getSessionPromptParams, clearSessionPromptParams } from "../../shared/session-prompt-params-state"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import * as sharedModule from "../../shared"
import { _resetForTesting as resetClaudeCodeSessionState, subagentSessions } from "../claude-code-session-state"
import type { BackgroundTask, ResumeInput } from "./types"
import { MIN_IDLE_TIME_MS } from "./constants"
import { BackgroundManager } from "./manager"
import { ConcurrencyManager } from "./concurrency"
import { initTaskToastManager, _resetTaskToastManagerForTesting } from "../task-toast-manager/manager"
import { _resetForTesting as resetProcessCleanupState } from "./process-cleanup"

mock.module("../../shared/connected-providers-cache", () => ({
  readConnectedProvidersCache: () => null,
  readProviderModelsCache: () => null,
  hasConnectedProvidersCache: () => false,
  hasProviderModelsCache: () => false,
  writeProviderModelsCache: () => {},
  updateConnectedProvidersCache: () => {},
}))
mock.module("../../shared/frontmatter", () => ({
  parseFrontmatter: () => ({ frontmatter: {}, content: "" }),
}))
mock.module("js-yaml", () => ({
  load: () => ({}),
}))
mock.restore()


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

  findBySession(sessionId: string): BackgroundTask | undefined {
    for (const task of this.tasks.values()) {
      if (task.sessionId === sessionId) {
        return task
      }
    }
    return undefined
  }

  getTasksByParentSession(sessionId: string): BackgroundTask[] {
    const result: BackgroundTask[] = []
    for (const task of this.tasks.values()) {
      if (task.parentSessionId === sessionId) {
        result.push(task)
      }
    }
    return result
  }

  getAllDescendantTasks(sessionId: string): BackgroundTask[] {
    const result: BackgroundTask[] = []
    const directChildren = this.getTasksByParentSession(sessionId)

    for (const child of directChildren) {
      result.push(child)
      if (child.sessionId) {
        const descendants = this.getAllDescendantTasks(child.sessionId)
        result.push(...descendants)
      }
    }

    return result
  }

  markForNotification(task: BackgroundTask): void {
    const queue = this.notifications.get(task.parentSessionId) ?? []
    queue.push(task)
    this.notifications.set(task.parentSessionId, queue)
  }

  getPendingNotifications(sessionId: string): BackgroundTask[] {
    return this.notifications.get(sessionId) ?? []
  }

  private clearNotificationsForTask(taskId: string): void {
    for (const [sessionId, tasks] of this.notifications.entries()) {
      const filtered = tasks.filter((t) => t.id !== taskId)
      if (filtered.length === 0) {
        this.notifications.delete(sessionId)
      } else {
        this.notifications.set(sessionId, filtered)
      }
    }
  }

  pruneStaleTasksAndNotifications(): { prunedTasks: string[]; prunedNotifications: number } {
    const now = Date.now()
    const prunedTasks: string[] = []
    let prunedNotifications = 0

    for (const [taskId, task] of this.tasks.entries()) {
      if (!task.startedAt) continue
      const age = now - task.startedAt.getTime()
      if (age > TASK_TTL_MS) {
        prunedTasks.push(taskId)
        this.clearNotificationsForTask(taskId)
        this.tasks.delete(taskId)
      }
    }

    for (const [sessionId, notifications] of this.notifications.entries()) {
      if (notifications.length === 0) {
        this.notifications.delete(sessionId)
        continue
      }
      const validNotifications = notifications.filter((task) => {
        if (!task.startedAt) return false
        const age = now - task.startedAt.getTime()
        return age <= TASK_TTL_MS
      })
      const removed = notifications.length - validNotifications.length
      prunedNotifications += removed
      if (validNotifications.length === 0) {
        this.notifications.delete(sessionId)
      } else if (validNotifications.length !== notifications.length) {
        this.notifications.set(sessionId, validNotifications)
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
    existingTask.parentSessionId = input.parentSessionId
    existingTask.parentMessageId = input.parentMessageId
    existingTask.parentModel = input.parentModel

    existingTask.progress = {
      toolCalls: existingTask.progress?.toolCalls ?? 0,
      lastUpdate: new Date(),
    }

    return existingTask
  }
}

function createMockTask(overrides: Partial<BackgroundTask> & { id: string; parentSessionId: string; sessionId?: string }): BackgroundTask {
  return {
    parentMessageId: "mock-message-id",
    description: "test task",
    prompt: "test prompt",
    agent: "test-agent",
    status: "running",
    startedAt: new Date(),
    ...overrides,
  }
}

function cast<T>(value: unknown): T {
  return value as T
}

function createBackgroundManager(): BackgroundManager {
  const client = {
    session: {
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
    },
  }
  return new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
}

function createBackgroundManagerWithOptions(options: Partial<ConstructorParameters<typeof BackgroundManager>[0]>): BackgroundManager {
  const client = {
    session: {
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
    },
  }
  return new BackgroundManager({
    pluginContext: { client, directory: tmpdir() } as unknown as PluginInput,
    config: undefined,
    ...options,
  })
}

function getConcurrencyManager(manager: BackgroundManager): ConcurrencyManager {
  return (cast<{ concurrencyManager: ConcurrencyManager }>(manager)).concurrencyManager
}

function getTaskMap(manager: BackgroundManager): Map<string, BackgroundTask> {
  return (cast<{ tasks: Map<string, BackgroundTask> }>(manager)).tasks
}

function getPendingByParent(manager: BackgroundManager): Map<string, Set<string>> {
  return (cast<{ pendingByParent: Map<string, Set<string>> }>(manager)).pendingByParent
}

function getPendingNotifications(manager: BackgroundManager): Map<string, string[]> {
  return (cast<{ pendingNotifications: Map<string, string[]> }>(manager)).pendingNotifications
}

function getCompletionTimers(manager: BackgroundManager): Map<string, ReturnType<typeof setTimeout>> {
  return (cast<{ completionTimers: Map<string, ReturnType<typeof setTimeout>> }>(manager)).completionTimers
}

function getRootDescendantCounts(manager: BackgroundManager): Map<string, number> {
  return (cast<{ rootDescendantCounts: Map<string, number> }>(manager)).rootDescendantCounts
}

function getPreStartDescendantReservations(manager: BackgroundManager): Set<string> {
  return (cast<{ preStartDescendantReservations: Set<string> }>(manager)).preStartDescendantReservations
}

function getQueuesByKey(
  manager: BackgroundManager
): Map<string, Array<{ task: BackgroundTask; input: import("./types").LaunchInput }>> {
  return (cast<{
    queuesByKey: Map<string, Array<{ task: BackgroundTask; input: import("./types").LaunchInput }>>
  }>(manager)).queuesByKey
}

async function processKeyForTest(manager: BackgroundManager, key: string): Promise<void> {
  return (cast<{ processKey: (key: string) => Promise<void> }>(manager)).processKey(key)
}

function pruneStaleTasksAndNotificationsForTest(manager: BackgroundManager): void {
  ;(cast<{ pruneStaleTasksAndNotifications: () => void }>(manager)).pruneStaleTasksAndNotifications()
}

async function tryCompleteTaskForTest(manager: BackgroundManager, task: BackgroundTask): Promise<boolean> {
  return (cast<{ tryCompleteTask: (task: BackgroundTask, source: string) => Promise<boolean> }>(manager))
    .tryCompleteTask(task, "test")
}

function stubNotifyParentSession(manager: BackgroundManager): void {
  ;(cast<{ notifyParentSession: () => Promise<void> }>(manager)).notifyParentSession = async () => {}
}

async function flushBackgroundNotifications(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve()
  }
}

function createToastRemoveTaskTracker(): { removeTaskCalls: string[]; resetToastManager: () => void } {
  _resetTaskToastManagerForTesting()
  const toastManager = initTaskToastManager(cast<PluginInput["client"]>({
    tui: { showToast: async () => {} },
  }))
  const removeTaskCalls: string[] = []
  const originalRemoveTask = toastManager.removeTask.bind(toastManager)
  toastManager.removeTask = (taskId: string): void => {
    removeTaskCalls.push(taskId)
    originalRemoveTask(taskId)
  }
  return {
    removeTaskCalls,
    resetToastManager: _resetTaskToastManagerForTesting,
  }
}

describe("BackgroundManager session.error fallback hydration", () => {
  test("hydrates fallbackChain from session fallback state before retrying sync child-session errors", async () => {
    //#given
    const fallbackChain = [
      { model: "fallback-model-1", providers: ["provider-a"], variant: undefined },
    ]
    const getSessionFallbackChain = mock((sessionId: string) =>
      sessionId === "child-session" ? fallbackChain : undefined,
    )
    const manager = createBackgroundManagerWithOptions({
      modelFallbackControllerAccessor: {
        register: () => {},
        setSessionFallbackChain: () => {},
        getSessionFallbackChain,
        clearSessionFallbackChain: () => {},
      },
    })
    const task = createMockTask({
      id: "task-sync-fallback",
      sessionId: "child-session",
      parentSessionId: "parent-session",
      fallbackChain: undefined,
    })
    let capturedFallbackChain: BackgroundTask["fallbackChain"]
    ;(cast<{
      tryFallbackRetry: (task: BackgroundTask, errorInfo: { name?: string; message?: string }, source: string) => Promise<boolean>
    }>(manager)).tryFallbackRetry = async (retryTask) => {
      capturedFallbackChain = retryTask.fallbackChain
      return true
    }

    //#when
    await (cast<{
      handleSessionErrorEvent: (args: {
        task: BackgroundTask
        errorInfo: { name?: string; message?: string }
        errorName: string | undefined
        errorMessage: string | undefined
      }) => Promise<void>
    }>(manager)).handleSessionErrorEvent({
      task,
      errorInfo: {
        name: "APIError",
        message: "Forbidden: Selected provider is forbidden",
      },
      errorName: "APIError",
      errorMessage: "Forbidden: Selected provider is forbidden",
    })

    //#then
    expect(getSessionFallbackChain).toHaveBeenCalledWith("child-session")
    expect(task.fallbackChain).toEqual(fallbackChain)
    expect(capturedFallbackChain).toEqual(fallbackChain)
  })
})

describe("BackgroundManager prompt rejection fallback routing", () => {
  test("routes launch-time prompt rejections into tryFallbackRetry before marking interrupt", async () => {
    //#given
    const promptError = {
      name: "APIError",
      data: { message: "Forbidden: Selected provider is forbidden" },
    }
    const client = {
      session: {
        get: async () => ({ data: { directory: tmpdir() } }),
        create: async () => ({ data: { id: "ses_launch_retry" } }),
        promptAsync: async () => {
          throw promptError
        },
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    stubNotifyParentSession(manager)
    ;(cast<{
      reserveSubagentSpawn: () => Promise<{
        spawnContext: { rootSessionID: string; parentDepth: number; childDepth: number }
        descendantCount: number
        commit: () => number
        rollback: () => void
      }>
    }>(manager)).reserveSubagentSpawn = async () => ({
      spawnContext: { rootSessionID: "parent-session", parentDepth: 0, childDepth: 1 },
      descendantCount: 1,
      commit: () => 1,
      rollback: () => {},
    })
    const retried: Array<{ taskId: string; errorInfo: { name?: string; message?: string }; source: string }> = []
    ;(cast<{
      tryFallbackRetry: (task: BackgroundTask, errorInfo: { name?: string; message?: string }, source: string) => Promise<boolean>
    }>(manager)).tryFallbackRetry = async (task, errorInfo, source) => {
      retried.push({ taskId: task.id, errorInfo, source })
      task.status = "pending"
      task.error = undefined
      return true
    }

    //#when
    const launchedTask = await manager.launch({
      description: "background retry test",
      prompt: "say hi",
      agent: "sisyphus-junior",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
      model: { providerID: "genai-proxy-openai", modelID: "gpt-5.4-mini" },
      fallbackChain: [{ model: "claude-haiku-4-5", providers: ["anthropic"] }],
    })
    await flushBackgroundNotifications()

    //#then
    const storedTask = getTaskMap(manager).get(launchedTask.id)
    expect(retried).toHaveLength(1)
    expect(retried[0]?.source).toBe("promptAsync.launch")
    expect(retried[0]?.errorInfo).toEqual({
      name: "APIError",
      message: "Forbidden: Selected provider is forbidden",
    })
    expect(storedTask?.status).toBe("pending")
  })

  test("routes resume-time prompt rejections into tryFallbackRetry before marking interrupt", async () => {
    //#given
    const promptError = {
      name: "APIError",
      data: { message: "Forbidden: Selected provider is forbidden" },
    }
    const client = {
      session: {
        promptAsync: async () => {
          throw promptError
        },
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    stubNotifyParentSession(manager)
    const task: BackgroundTask = {
      id: "bg_resume_retry",
      sessionId: "ses_resume_retry",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
      description: "resume retry test",
      prompt: "say hi",
      agent: "sisyphus-junior",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      model: { providerID: "genai-proxy-openai", modelID: "gpt-5.4-mini" },
      fallbackChain: [{ model: "claude-haiku-4-5", providers: ["anthropic"] }],
      concurrencyGroup: "genai-proxy-openai/gpt-5.4-mini",
    }
    getTaskMap(manager).set(task.id, task)
    const retried: Array<{ taskId: string; errorInfo: { name?: string; message?: string }; source: string }> = []
    ;(cast<{
      tryFallbackRetry: (task: BackgroundTask, errorInfo: { name?: string; message?: string }, source: string) => Promise<boolean>
    }>(manager)).tryFallbackRetry = async (retryTask, errorInfo, source) => {
      retried.push({ taskId: retryTask.id, errorInfo, source })
      retryTask.status = "pending"
      retryTask.error = undefined
      return true
    }

    //#when
    await manager.resume({
      sessionId: "ses_resume_retry",
      prompt: "continue",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message-2",
    })
    await flushBackgroundNotifications()

    //#then
    const storedTask = getTaskMap(manager).get(task.id)
    expect(retried).toHaveLength(1)
    expect(retried[0]?.source).toBe("promptAsync.resume")
    expect(retried[0]?.errorInfo).toEqual({
      name: "APIError",
      message: "Forbidden: Selected provider is forbidden",
    })
    expect(storedTask?.status).toBe("pending")
  })
})

describe("BackgroundManager retry observability", () => {
  test("queues a parent-visible retry notification when fallback retry is scheduled", async () => {
    //#given
    const client = {
      session: {
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    const task = createMockTask({
      id: "bg_retry_observable",
      parentSessionId: "parent-session",
      fallbackChain: [{ model: "claude-haiku-4-5", providers: ["anthropic"] }],
      attemptCount: 0,
      status: "running",
      attempts: [
        {
          attemptId: "att_retry_visibility",
          attemptNumber: 1,
          sessionId: "ses_retry_visibility",
          providerId: "genai-proxy-openai",
          modelId: "gpt-5.4-mini",
          status: "running",
        },
      ],
      currentAttemptID: "att_retry_visibility",
    })
    getTaskMap(manager).set(task.id, task)
    const queuePendingNotification = mock(() => {})
    ;(manager as unknown as {
      queuePendingNotification: (sessionId: string | undefined, notification: string) => void
    }).queuePendingNotification = queuePendingNotification

    //#when
    await (cast<{
      tryFallbackRetry: (task: BackgroundTask, errorInfo: { name?: string; message?: string }, source: string) => Promise<boolean>
    }>(manager)).tryFallbackRetry(task, {
      name: "APIError",
      message: "Forbidden: Selected provider is forbidden",
    }, "promptAsync.launch")

    //#then
    expect(queuePendingNotification).toHaveBeenCalledTimes(1)
    const [sessionID, notification] = queuePendingNotification.mock.calls[0]
    expect(sessionID).toBe("parent-session")
    expect(notification).toContain("[BACKGROUND TASK RETRYING]")
    expect(notification).toContain("ses_retry_visibility")
    expect(notification).toContain("genai-proxy-openai/gpt-5.4-mini")
    expect(notification).toContain("anthropic/claude-haiku-4.5")
  })

  test("queues a second parent-visible notification once the retry session ID is created", async () => {
    //#given
    const queuePendingNotification = mock(() => {})
    const client = {
      session: {
        get: async () => ({ data: { directory: tmpdir() } }),
        create: async () => ({ data: { id: "ses_retry_created" } }),
        promptAsync: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    ;(manager as unknown as {
      queuePendingNotification: (sessionId: string | undefined, notification: string) => void
    }).queuePendingNotification = queuePendingNotification
    const task = createMockTask({
      id: "bg_retry_ready",
      parentSessionId: "parent-session",
      status: "pending",
      attemptCount: 1,
      queuedAt: new Date(),
      model: { providerID: "anthropic", modelID: "claude-haiku-4.5" },
      fallbackChain: [{ model: "claude-haiku-4-5", providers: ["anthropic"] }],
      concurrencyGroup: "anthropic/claude-haiku-4.5",
      retryNotification: {
        nextModel: "anthropic/claude-haiku-4.5",
      },
      attempts: [
        {
          attemptId: "att_retry_failed",
          attemptNumber: 1,
          sessionId: "ses_retry_visibility",
          providerId: "genai-proxy-openai",
          modelId: "gpt-5.4-mini",
          status: "error",
          error: "Forbidden: Selected provider is forbidden",
        },
        {
          attemptId: "att_retry_ready",
          attemptNumber: 2,
          providerId: "anthropic",
          modelId: "claude-haiku-4.5",
          status: "pending",
        },
      ],
      currentAttemptID: "att_retry_ready",
    })
    getTaskMap(manager).set(task.id, task)
    const taskInput = {
      description: task.description,
      prompt: task.prompt,
      agent: task.agent,
      parentSessionId: task.parentSessionId,
      parentMessageId: task.parentMessageId,
      model: task.model,
      fallbackChain: task.fallbackChain,
      category: task.category,
    }
    type RetryReadyQueueItem = {
      task: BackgroundTask
      input: typeof taskInput
      attemptID: string
    }
    const item: RetryReadyQueueItem = {
      task,
      input: taskInput,
      attemptID: task.currentAttemptID ?? "att_retry_ready",
    }

    //#when
    await (cast<{
      startTask: (queueItem: RetryReadyQueueItem) => Promise<void>
    }>(manager)).startTask(item)

    //#then
    const notifications = cast<Array<[string | undefined, string]>>(queuePendingNotification.mock.calls).map((call) => call[1])
    const retryReadyNotification = notifications.find((notification) => notification.includes("[BACKGROUND TASK RETRY SESSION READY]"))
    const expectedRetryLink = `http://127.0.0.1:4096/${Buffer.from(tmpdir()).toString("base64url")}/session/ses_retry_created`
    expect(retryReadyNotification).toBeDefined()
    expect(retryReadyNotification).toContain("**Retry attempt:** 2")
    expect(retryReadyNotification).toContain("ses_retry_created")
    expect(retryReadyNotification).toContain(expectedRetryLink)
    expect(retryReadyNotification).toContain("ses_retry_visibility")
    expect(retryReadyNotification).toContain("genai-proxy-openai/gpt-5.4-mini")
    expect(retryReadyNotification).toContain("Forbidden: Selected provider is forbidden")
  })

  test("builds retry-ready links from the parent session directory when it differs from the manager directory", async () => {
    //#given
    const queuePendingNotification = mock(() => {})
    const managerDirectory = "/manager/dir"
    const parentDirectory = "/parent/dir"
    const client = {
      session: {
        get: async () => ({ data: { directory: parentDirectory } }),
        create: async () => ({ data: { id: "ses_retry_created_parent_dir" } }),
        promptAsync: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: managerDirectory } as unknown as PluginInput })
    ;(manager as unknown as {
      queuePendingNotification: (sessionId: string | undefined, notification: string) => void
    }).queuePendingNotification = queuePendingNotification
    const task = createMockTask({
      id: "bg_retry_ready_parent_dir",
      parentSessionId: "parent-session",
      status: "pending",
      attemptCount: 1,
      queuedAt: new Date(),
      model: { providerID: "anthropic", modelID: "claude-haiku-4.5" },
      retryNotification: {
        nextModel: "anthropic/claude-haiku-4.5",
      },
      attempts: [
        {
          attemptId: "att_retry_failed_parent_dir",
          attemptNumber: 1,
          sessionId: "ses_retry_failed_parent_dir",
          providerId: "genai-proxy-openai",
          modelId: "gpt-5.4-mini",
          status: "error",
          error: "Forbidden: Selected provider is forbidden",
        },
        {
          attemptId: "att_retry_ready_parent_dir",
          attemptNumber: 2,
          providerId: "anthropic",
          modelId: "claude-haiku-4.5",
          status: "pending",
        },
      ],
      currentAttemptID: "att_retry_ready_parent_dir",
    })
    getTaskMap(manager).set(task.id, task)
    const taskInput = {
      description: task.description,
      prompt: task.prompt,
      agent: task.agent,
      parentSessionId: task.parentSessionId,
      parentMessageId: task.parentMessageId,
      model: task.model,
      fallbackChain: task.fallbackChain,
      category: task.category,
    }

    //#when
    await (cast<{
      startTask: (queueItem: { task: BackgroundTask; input: typeof taskInput; attemptID: string }) => Promise<void>
    }>(manager)).startTask({ task, input: taskInput, attemptID: "att_retry_ready_parent_dir" })

    //#then
		const retryReadyNotification = cast<Array<[string | undefined, string]>>(queuePendingNotification.mock.calls)
			.map((call) => call[1])
			.find((notification) => notification.includes("[BACKGROUND TASK RETRY SESSION READY]"))
    const expectedRetryLink = `http://127.0.0.1:4096/${Buffer.from(parentDirectory).toString("base64url")}/session/ses_retry_created_parent_dir`
    expect(retryReadyNotification).toBeDefined()
    expect(retryReadyNotification).toContain(expectedRetryLink)

    manager.shutdown()
  })
})

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
    // given
    manager = new MockBackgroundManager()
  })

  test("should return empty array when no tasks exist", () => {
    // when
    const result = manager.getAllDescendantTasks("session-a")

    // then
    expect(result).toEqual([])
  })

  test("should return direct children only when no nested tasks", () => {
    // given
    const taskB = createMockTask({
      id: "task-b",
      sessionId: "session-b",
      parentSessionId: "session-a",
    })
    manager.addTask(taskB)

    // when
    const result = manager.getAllDescendantTasks("session-a")

    // then
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("task-b")
  })

  test("should return all nested descendants (2 levels deep)", () => {
    // given
    // Session A -> Task B -> Task C
    const taskB = createMockTask({
      id: "task-b",
      sessionId: "session-b",
      parentSessionId: "session-a",
    })
    const taskC = createMockTask({
      id: "task-c",
      sessionId: "session-c",
      parentSessionId: "session-b",
    })
    manager.addTask(taskB)
    manager.addTask(taskC)

    // when
    const result = manager.getAllDescendantTasks("session-a")

    // then
    expect(result).toHaveLength(2)
    expect(result.map(t => t.id)).toContain("task-b")
    expect(result.map(t => t.id)).toContain("task-c")
  })

  test("should return all nested descendants (3 levels deep)", () => {
    // given
    // Session A -> Task B -> Task C -> Task D
    const taskB = createMockTask({
      id: "task-b",
      sessionId: "session-b",
      parentSessionId: "session-a",
    })
    const taskC = createMockTask({
      id: "task-c",
      sessionId: "session-c",
      parentSessionId: "session-b",
    })
    const taskD = createMockTask({
      id: "task-d",
      sessionId: "session-d",
      parentSessionId: "session-c",
    })
    manager.addTask(taskB)
    manager.addTask(taskC)
    manager.addTask(taskD)

    // when
    const result = manager.getAllDescendantTasks("session-a")

    // then
    expect(result).toHaveLength(3)
    expect(result.map(t => t.id)).toContain("task-b")
    expect(result.map(t => t.id)).toContain("task-c")
    expect(result.map(t => t.id)).toContain("task-d")
  })

  test("should handle multiple branches (tree structure)", () => {
    // given
    // Session A -> Task B1 -> Task C1
    //           -> Task B2 -> Task C2
    const taskB1 = createMockTask({
      id: "task-b1",
      sessionId: "session-b1",
      parentSessionId: "session-a",
    })
    const taskB2 = createMockTask({
      id: "task-b2",
      sessionId: "session-b2",
      parentSessionId: "session-a",
    })
    const taskC1 = createMockTask({
      id: "task-c1",
      sessionId: "session-c1",
      parentSessionId: "session-b1",
    })
    const taskC2 = createMockTask({
      id: "task-c2",
      sessionId: "session-c2",
      parentSessionId: "session-b2",
    })
    manager.addTask(taskB1)
    manager.addTask(taskB2)
    manager.addTask(taskC1)
    manager.addTask(taskC2)

    // when
    const result = manager.getAllDescendantTasks("session-a")

    // then
    expect(result).toHaveLength(4)
    expect(result.map(t => t.id)).toContain("task-b1")
    expect(result.map(t => t.id)).toContain("task-b2")
    expect(result.map(t => t.id)).toContain("task-c1")
    expect(result.map(t => t.id)).toContain("task-c2")
  })

  test("should not include tasks from unrelated sessions", () => {
    // given
    // Session A -> Task B
    // Session X -> Task Y (unrelated)
    const taskB = createMockTask({
      id: "task-b",
      sessionId: "session-b",
      parentSessionId: "session-a",
    })
    const taskY = createMockTask({
      id: "task-y",
      sessionId: "session-y",
      parentSessionId: "session-x",
    })
    manager.addTask(taskB)
    manager.addTask(taskY)

    // when
    const result = manager.getAllDescendantTasks("session-a")

    // then
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("task-b")
    expect(result.map(t => t.id)).not.toContain("task-y")
  })

  test("getTasksByParentSession should only return direct children (not recursive)", () => {
    // given
    // Session A -> Task B -> Task C
    const taskB = createMockTask({
      id: "task-b",
      sessionId: "session-b",
      parentSessionId: "session-a",
    })
    const taskC = createMockTask({
      id: "task-c",
      sessionId: "session-c",
      parentSessionId: "session-b",
    })
    manager.addTask(taskB)
    manager.addTask(taskC)

    // when
    const result = manager.getTasksByParentSession("session-a")

    // then
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("task-b")
  })
})

describe("BackgroundManager.notifyParentSession - release ordering", () => {
  test("should unblock queued task even when prompt hangs", async () => {
    // given - concurrency limit 1, task1 running, task2 waiting
    const { ConcurrencyManager } = await import("./concurrency")
    const concurrencyManager = new ConcurrencyManager({ defaultConcurrency: 1 })

    await concurrencyManager.acquire("explore")

    let task2Resolved = false
    const task2Promise = concurrencyManager.acquire("explore").then(() => {
      task2Resolved = true
    })

    await Promise.resolve()
    expect(task2Resolved).toBe(false)

    // when - simulate notifyParentSession: release BEFORE prompt (fixed behavior)
    let promptStarted = false
    const simulateNotifyParentSession = async () => {
      concurrencyManager.release("explore")

      promptStarted = true
      await new Promise(() => {})
    }

    simulateNotifyParentSession()

    await Promise.resolve()
    await Promise.resolve()

    // then - task2 should be unblocked even though prompt never completes
    expect(promptStarted).toBe(true)
    await task2Promise
    expect(task2Resolved).toBe(true)
  })

  test("should keep queue blocked if release is after prompt (demonstrates the bug)", async () => {
    // given
    const { ConcurrencyManager } = await import("./concurrency")
    const concurrencyManager = new ConcurrencyManager({ defaultConcurrency: 1 })

    await concurrencyManager.acquire("explore")

    let task2Resolved = false
    concurrencyManager.acquire("explore").then(() => {
      task2Resolved = true
    })

    await Promise.resolve()
    expect(task2Resolved).toBe(false)

    // when - simulate BUGGY behavior: release AFTER prompt (in finally)
    const simulateBuggyNotifyParentSession = async () => {
      try {
        await new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 50))
      } finally {
        concurrencyManager.release("explore")
      }
    }

    await simulateBuggyNotifyParentSession().catch(() => {})

    // then - task2 resolves only after prompt completes (blocked during hang)
    await Promise.resolve()
    expect(task2Resolved).toBe(true)
  })
})

describe("BackgroundManager.pruneStaleTasksAndNotifications", () => {
  let manager: MockBackgroundManager

  beforeEach(() => {
    // given
    manager = new MockBackgroundManager()
  })

  test("should not prune fresh tasks", () => {
    // given
    const task = createMockTask({
      id: "task-fresh",
      sessionId: "session-fresh",
      parentSessionId: "session-parent",
      startedAt: new Date(),
    })
    manager.addTask(task)

    // when
    const result = manager.pruneStaleTasksAndNotifications()

    // then
    expect(result.prunedTasks).toHaveLength(0)
    expect(manager.getTaskCount()).toBe(1)
  })

  test("should prune tasks older than 30 minutes", () => {
    // given
    const staleDate = new Date(Date.now() - 31 * 60 * 1000)
    const task = createMockTask({
      id: "task-stale",
      sessionId: "session-stale",
      parentSessionId: "session-parent",
      startedAt: staleDate,
    })
    manager.addTask(task)

    // when
    const result = manager.pruneStaleTasksAndNotifications()

    // then
    expect(result.prunedTasks).toContain("task-stale")
    expect(manager.getTaskCount()).toBe(0)
  })

  test("should prune stale notifications", () => {
    // given
    const staleDate = new Date(Date.now() - 31 * 60 * 1000)
    const task = createMockTask({
      id: "task-stale",
      sessionId: "session-stale",
      parentSessionId: "session-parent",
      startedAt: staleDate,
    })
    manager.markForNotification(task)

    // when
    const result = manager.pruneStaleTasksAndNotifications()

    // then
    expect(result.prunedNotifications).toBe(1)
    expect(manager.getNotificationCount()).toBe(0)
  })

  test("should clean up notifications when task is pruned", () => {
    // given
    const staleDate = new Date(Date.now() - 31 * 60 * 1000)
    const task = createMockTask({
      id: "task-stale",
      sessionId: "session-stale",
      parentSessionId: "session-parent",
      startedAt: staleDate,
    })
    manager.addTask(task)
    manager.markForNotification(task)

    // when
    manager.pruneStaleTasksAndNotifications()

    // then
    expect(manager.getTaskCount()).toBe(0)
    expect(manager.getNotificationCount()).toBe(0)
  })

  test("should keep fresh tasks while pruning stale ones", () => {
    // given
    const staleDate = new Date(Date.now() - 31 * 60 * 1000)
    const staleTask = createMockTask({
      id: "task-stale",
      sessionId: "session-stale",
      parentSessionId: "session-parent",
      startedAt: staleDate,
    })
    const freshTask = createMockTask({
      id: "task-fresh",
      sessionId: "session-fresh",
      parentSessionId: "session-parent",
      startedAt: new Date(),
    })
    manager.addTask(staleTask)
    manager.addTask(freshTask)

    // when
    const result = manager.pruneStaleTasksAndNotifications()

    // then
    expect(result.prunedTasks).toHaveLength(1)
    expect(result.prunedTasks).toContain("task-stale")
    expect(manager.getTaskCount()).toBe(1)
    expect(manager.getTask("task-fresh")).toBeDefined()
  })
})

describe("BackgroundManager.resume", () => {
  let manager: MockBackgroundManager

  beforeEach(() => {
    // given
    manager = new MockBackgroundManager()
  })

  test("should throw error when task not found", () => {
    // when / then
    expect(() => manager.resume({
      sessionId: "non-existent",
      prompt: "continue",
      parentSessionId: "session-new",
      parentMessageId: "msg-new",
    })).toThrow("Task not found for session: non-existent")
  })

  test("should resume existing task and reset state to running", () => {
    // given
    const completedTask = createMockTask({
      id: "task-a",
      sessionId: "session-a",
      parentSessionId: "session-parent",
      status: "completed",
    })
    completedTask.completedAt = new Date()
    completedTask.error = "previous error"
    manager.addTask(completedTask)

    // when
    const result = manager.resume({
      sessionId: "session-a",
      prompt: "continue the work",
      parentSessionId: "session-new-parent",
      parentMessageId: "msg-new",
    })

    // then
    expect(result.status).toBe("running")
    expect(result.completedAt).toBeUndefined()
    expect(result.error).toBeUndefined()
    expect(result.parentSessionId).toBe("session-new-parent")
    expect(result.parentMessageId).toBe("msg-new")
  })

  test("should preserve task identity while updating parent context", () => {
    // given
    const existingTask = createMockTask({
      id: "task-a",
      sessionId: "session-a",
      parentSessionId: "old-parent",
      description: "original description",
      agent: "explore",
      status: "completed",
    })
    manager.addTask(existingTask)

    // when
    const result = manager.resume({
      sessionId: "session-a",
      prompt: "new prompt",
      parentSessionId: "new-parent",
      parentMessageId: "new-msg",
      parentModel: { providerID: "anthropic", modelID: "claude-opus" },
    })

    // then
    expect(result.id).toBe("task-a")
    expect(result.sessionId).toBe("session-a")
    expect(result.description).toBe("original description")
    expect(result.agent).toBe("explore")
    expect(result.parentModel).toEqual({ providerID: "anthropic", modelID: "claude-opus" })
  })

  test("should track resume calls with prompt", () => {
    // given
    const task = createMockTask({
      id: "task-a",
      sessionId: "session-a",
      parentSessionId: "session-parent",
      status: "completed",
    })
    manager.addTask(task)

    // when
    manager.resume({
      sessionId: "session-a",
      prompt: "continue with additional context",
      parentSessionId: "session-new",
      parentMessageId: "msg-new",
    })

    // then
    expect(manager.resumeCalls).toHaveLength(1)
    expect(manager.resumeCalls[0]).toEqual({
      sessionId: "session-a",
      prompt: "continue with additional context",
    })
  })

  test("should preserve existing tool call count in progress", () => {
    // given
    const taskWithProgress = createMockTask({
      id: "task-a",
      sessionId: "session-a",
      parentSessionId: "session-parent",
      status: "completed",
    })
    taskWithProgress.progress = {
      toolCalls: 42,
      lastTool: "read",
      lastUpdate: new Date(),
    }
    manager.addTask(taskWithProgress)

    // when
    const result = manager.resume({
      sessionId: "session-a",
      prompt: "continue",
      parentSessionId: "session-new",
      parentMessageId: "msg-new",
    })

    // then
    expect(result.progress?.toolCalls).toBe(42)
  })

  test("should ignore resume when task is already running", () => {
    // given
    const runningTask = createMockTask({
      id: "task-a",
      sessionId: "session-a",
      parentSessionId: "session-parent",
      status: "running",
    })
    manager.addTask(runningTask)

    // when
    const result = manager.resume({
      sessionId: "session-a",
      prompt: "resume should be ignored",
      parentSessionId: "new-parent",
      parentMessageId: "new-msg",
    })

    // then
    expect(result.parentSessionId).toBe("session-parent")
    expect(manager.resumeCalls).toHaveLength(0)
  })
})

describe("LaunchInput.skillContent", () => {
  test("skillContent should be optional in LaunchInput type", () => {
    // given
    const input: import("./types").LaunchInput = {
      description: "test",
      prompt: "test prompt",
      agent: "explore",
      parentSessionId: "parent-session",
      parentMessageId: "parent-msg",
    }

    // when / then
    expect(input.skillContent).toBeUndefined()
  })

  test("skillContent can be provided in LaunchInput", () => {
    // given
    const input: import("./types").LaunchInput = {
      description: "test",
      prompt: "test prompt",
      agent: "explore",
      parentSessionId: "parent-session",
      parentMessageId: "parent-msg",
      skillContent: "You are a playwright expert",
    }

    // when / #then
    expect(input.skillContent).toBe("You are a playwright expert")
  })
})

interface CurrentMessage {
  agent?: string
  model?: { providerID?: string; modelID?: string }
}

describe("BackgroundManager.notifyParentSession - dynamic message lookup", () => {
  test("should skip compaction agent and use nearest non-compaction message", async () => {
    //#given
    let capturedBody: Record<string, unknown> | undefined
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async (args: { body: Record<string, unknown> }) => {
          capturedBody = args.body
          return {}
        },
        abort: async () => ({}),
        messages: async () => ({
          data: [
            {
              info: {
                agent: "sisyphus",
                model: { providerID: "anthropic", modelID: "claude-opus-4.7" },
              },
            },
            {
              info: {
                agent: "compaction",
                model: { providerID: "anthropic", modelID: "claude-sonnet-4.6" },
              },
            },
          ],
        }),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    const task: BackgroundTask = {
      id: "task-skip-compaction",
      sessionId: "session-child",
      parentSessionId: "session-parent",
      parentMessageId: "msg-parent",
      description: "task with compaction at tail",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      parentAgent: "fallback-agent",
    }
    getPendingByParent(manager).set("session-parent", new Set([task.id, "still-running"]))

    //#when
    await (cast<{ notifyParentSession: (value: BackgroundTask) => Promise<void> }>(manager))
      .notifyParentSession(task)

    //#then
    expect(capturedBody?.agent).toBe("sisyphus")
    expect(capturedBody?.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4.7" })

    manager.shutdown()
  })

  test("should use currentMessage model/agent when available", async () => {
    // given
    const task: BackgroundTask = {
      id: "task-1",
      sessionId: "session-child",
      parentSessionId: "session-parent",
      parentMessageId: "msg-parent",
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
      agent: "sisyphus",
      model: { providerID: "anthropic", modelID: "claude-opus-4.7" },
    }

    // when
    const promptBody = buildNotificationPromptBody(task, currentMessage)

    // then
    expect(promptBody.agent).toBe("sisyphus")
    expect(promptBody.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4.7" })
  })

  test("should fallback to parentAgent when currentMessage.agent is undefined", async () => {
    // given
    const task: BackgroundTask = {
      id: "task-2",
      sessionId: "session-child",
      parentSessionId: "session-parent",
      parentMessageId: "msg-parent",
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

    // when
    const promptBody = buildNotificationPromptBody(task, currentMessage)

    // then
    expect(promptBody.agent).toBe("FallbackAgent")
    expect("model" in promptBody).toBe(false)
  })

  test("should not pass model when currentMessage.model is incomplete", async () => {
    // given - model missing modelID
    const task: BackgroundTask = {
      id: "task-3",
      sessionId: "session-child",
      parentSessionId: "session-parent",
      parentMessageId: "msg-parent",
      description: "task incomplete model",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      parentAgent: "sisyphus",
      parentModel: { providerID: "anthropic", modelID: "claude-opus" },
    }
    const currentMessage: CurrentMessage = {
      agent: "sisyphus",
      model: { providerID: "anthropic" },
    }

    // when
    const promptBody = buildNotificationPromptBody(task, currentMessage)

    // then
    expect(promptBody.agent).toBe("sisyphus")
    expect("model" in promptBody).toBe(false)
  })

  test("should handle null currentMessage gracefully", async () => {
    // given - no message found (messageDir lookup failed)
    const task: BackgroundTask = {
      id: "task-4",
      sessionId: "session-child",
      parentSessionId: "session-parent",
      parentMessageId: "msg-parent",
      description: "task no message",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      parentAgent: "sisyphus",
      parentModel: { providerID: "anthropic", modelID: "claude-opus" },
    }

    // when
    const promptBody = buildNotificationPromptBody(task, null)

    // then
    expect(promptBody.agent).toBe("sisyphus")
    expect("model" in promptBody).toBe(false)
  })
})

describe("BackgroundManager.notifyParentSession - aborted parent", () => {
  test("should fall back and still notify when parent session messages are aborted", async () => {
    //#given
    let promptCalled = false
    const promptMock = async () => {
      promptCalled = true
      return {}
    }
    const client = {
      session: {
        prompt: promptMock,
        promptAsync: promptMock,
        abort: async () => ({}),
        messages: async () => {
          const error = new Error("User aborted")
          error.name = "MessageAbortedError"
          throw error
        },
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    const task: BackgroundTask = {
      id: "task-aborted-parent",
      sessionId: "session-child",
      parentSessionId: "session-parent",
      parentMessageId: "msg-parent",
      description: "task aborted parent",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    getPendingByParent(manager).set("session-parent", new Set([task.id, "task-remaining"]))

    //#when
    await (cast<{ notifyParentSession: (task: BackgroundTask) => Promise<void> }>(manager))
      .notifyParentSession(task)

    //#then
    expect(promptCalled).toBe(true)

    manager.shutdown()
  })

  test("should swallow aborted error from prompt", async () => {
    //#given
    let promptCalled = false
    const promptMock = async () => {
      promptCalled = true
      const error = new Error("User aborted")
      error.name = "MessageAbortedError"
      throw error
    }
    const client = {
      session: {
        prompt: promptMock,
        promptAsync: promptMock,
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    const task: BackgroundTask = {
      id: "task-aborted-prompt",
      sessionId: "session-child",
      parentSessionId: "session-parent",
      parentMessageId: "msg-parent",
      description: "task aborted prompt",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    getPendingByParent(manager).set("session-parent", new Set([task.id]))

    //#when
    await (cast<{ notifyParentSession: (task: BackgroundTask) => Promise<void> }>(manager))
      .notifyParentSession(task)

    //#then
    expect(promptCalled).toBe(true)

    manager.shutdown()
  })

  test("should queue notification when promptAsync aborts while parent is idle", async () => {
    //#given
    const promptMock = async () => {
      const error = new Error("Request aborted while waiting for input")
      error.name = "MessageAbortedError"
      throw error
    }
    const client = {
      session: {
        prompt: promptMock,
        promptAsync: promptMock,
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    const task: BackgroundTask = {
      id: "task-aborted-idle-queue",
      sessionId: "session-child",
      parentSessionId: "session-parent",
      parentMessageId: "msg-parent",
      description: "task idle queue",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    getPendingByParent(manager).set("session-parent", new Set([task.id]))

    //#when
    await (cast<{ notifyParentSession: (task: BackgroundTask) => Promise<void> }>(manager))
      .notifyParentSession(task)

    //#then
    const queuedNotifications = getPendingNotifications(manager).get("session-parent") ?? []
    expect(queuedNotifications).toHaveLength(1)
    expect(queuedNotifications[0]).toContain("<system-reminder>")
    expect(queuedNotifications[0]).toContain("[ALL BACKGROUND TASKS COMPLETE]")

    manager.shutdown()
  })
})

describe("BackgroundManager.notifyParentSession - notifications toggle", () => {
  test("should skip parent prompt injection when notifications are disabled", async () => {
    //#given
    let promptCalled = false
    const promptMock = async () => {
      promptCalled = true
      return {}
    }
    const client = {
      session: {
        prompt: promptMock,
        promptAsync: promptMock,
        abort: async () => ({}),
        messages: async () => ({
          data: [{
            info: {
              agent: "explore",
              model: {
                providerID: "anthropic",
                modelID: "claude-opus-4.7",
                variant: "high",
              },
            },
          }],
        }),
      },
    }
    const manager = new BackgroundManager(
      { pluginContext: { client, directory: tmpdir() } as unknown as PluginInput, config: undefined, enableParentSessionNotifications: false },
    )
    const task: BackgroundTask = {
      id: "task-no-parent-notification",
      sessionId: "session-child",
      parentSessionId: "session-parent",
      parentMessageId: "msg-parent",
      description: "task notifications disabled",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    getPendingByParent(manager).set("session-parent", new Set([task.id]))

    //#when
    await (cast<{ notifyParentSession: (task: BackgroundTask) => Promise<void> }>(manager))
      .notifyParentSession(task)

    //#then
    expect(promptCalled).toBe(false)

    manager.shutdown()
  })
})

describe("BackgroundManager.notifyParentSession - variant propagation", () => {
  test("should prefer parent session variant over child task variant in parent notification promptAsync body", async () => {
    //#given
    const promptCalls: Array<{ body: Record<string, unknown> }> = []
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push({ body: args.body })
          return {}
        },
        abort: async () => ({}),
        messages: async () => ({
          data: [{
            info: {
              agent: "explore",
              model: {
                providerID: "anthropic",
                modelID: "claude-opus-4.7",
                variant: "max",
              },
            },
          }],
        }),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    const task: BackgroundTask = {
      id: "task-parent-variant-wins",
      sessionId: "session-child",
      parentSessionId: "session-parent",
      parentMessageId: "msg-parent",
      description: "task with mismatched variant",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      model: { providerID: "anthropic", modelID: "claude-opus-4.7", variant: "high" },
    }
    getPendingByParent(manager).set("session-parent", new Set([task.id]))

    //#when
    await (cast<{ notifyParentSession: (task: BackgroundTask) => Promise<void> }>(manager))
      .notifyParentSession(task)

    //#then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0].body.variant).toBe("max")

    manager.shutdown()
  })

  test("should not include variant in promptAsync body when task has no variant", async () => {
    //#given
    const promptCalls: Array<{ body: Record<string, unknown> }> = []
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push({ body: args.body })
          return {}
        },
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    const task: BackgroundTask = {
      id: "task-no-variant",
      sessionId: "session-child",
      parentSessionId: "session-parent",
      parentMessageId: "msg-parent",
      description: "task without variant",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      model: { providerID: "anthropic", modelID: "claude-opus-4.7" },
    }
    getPendingByParent(manager).set("session-parent", new Set([task.id]))

    //#when
    await (cast<{ notifyParentSession: (task: BackgroundTask) => Promise<void> }>(manager))
      .notifyParentSession(task)

    //#then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0].body.variant).toBeUndefined()

    manager.shutdown()
  })
})

describe("BackgroundManager.injectPendingNotificationsIntoChatMessage", () => {
  test("should prepend queued notifications to first text part and clear queue", () => {
    // given
    const manager = createBackgroundManager()
    manager.queuePendingNotification("session-parent", "<system-reminder>queued-one</system-reminder>")
    manager.queuePendingNotification("session-parent", "<system-reminder>queued-two</system-reminder>")
    const output = {
      parts: [{ type: "text", text: "User prompt" }],
    }

    // when
    manager.injectPendingNotificationsIntoChatMessage(output, "session-parent")

    // then
    expect(output.parts[0].text).toContain("<system-reminder>queued-one</system-reminder>")
    expect(output.parts[0].text).toContain("<system-reminder>queued-two</system-reminder>")
    expect(output.parts[0].text).toContain("User prompt")
    expect(getPendingNotifications(manager).get("session-parent")).toBeUndefined()

    manager.shutdown()
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
    // given
    manager = createBackgroundManager()
    stubNotifyParentSession(manager)
  })

  afterEach(() => {
    manager.shutdown()
  })

  test("should release concurrency and clear key on completion", async () => {
    // given
    const concurrencyKey = "anthropic/claude-opus-4.7"
    const concurrencyManager = getConcurrencyManager(manager)
    await concurrencyManager.acquire(concurrencyKey)

    const task: BackgroundTask = {
      id: "task-1",
      sessionId: "session-1",
      parentSessionId: "session-parent",
      parentMessageId: "msg-1",
      description: "test task",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(),
      concurrencyKey,
    }

    // when
    const completed = await tryCompleteTaskForTest(manager, task)

    // then
    expect(completed).toBe(true)
    expect(task.status).toBe("completed")
    expect(task.concurrencyKey).toBeUndefined()
    expect(concurrencyManager.getCount(concurrencyKey)).toBe(0)
  })

  test("should prevent double completion and double release", async () => {
    // given
    const concurrencyKey = "anthropic/claude-opus-4.7"
    const concurrencyManager = getConcurrencyManager(manager)
    await concurrencyManager.acquire(concurrencyKey)

    const task: BackgroundTask = {
      id: "task-1",
      sessionId: "session-1",
      parentSessionId: "session-parent",
      parentMessageId: "msg-1",
      description: "test task",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(),
      concurrencyKey,
    }

    // when
    await tryCompleteTaskForTest(manager, task)
    const secondAttempt = await tryCompleteTaskForTest(manager, task)

    // then
    expect(secondAttempt).toBe(false)
    expect(task.status).toBe("completed")
    expect(concurrencyManager.getCount(concurrencyKey)).toBe(0)
  })

   test("should abort session on completion", async () => {
     // #given
     const abortedSessionIDs: string[] = []
     const client = {
       session: {
         prompt: async () => ({}),
         promptAsync: async () => ({}),
         abort: async (args: { path: { id: string } }) => {
           abortedSessionIDs.push(args.path.id)
           return {}
         },
         messages: async () => ({ data: [] }),
       },
     }
    manager.shutdown()
    manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-1",
      sessionId: "session-1",
      parentSessionId: "session-parent",
      parentMessageId: "msg-1",
      description: "test task",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(),
    }

    // #when
    await tryCompleteTaskForTest(manager, task)

    // #then
    expect(abortedSessionIDs).toEqual(["session-1"])
  })

  test("should clean pendingByParent even when promptAsync notification fails", async () => {
    // given
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => {
          throw new Error("notify failed")
        },
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
      },
    }
    manager.shutdown()
    manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })

    const task: BackgroundTask = {
      id: "task-pending-cleanup",
      sessionId: "session-pending-cleanup",
      parentSessionId: "parent-pending-cleanup",
      parentMessageId: "msg-1",
      description: "pending cleanup task",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(),
    }
    getTaskMap(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

    // when
    await tryCompleteTaskForTest(manager, task)

    // then
    expect(task.status).toBe("completed")
    expect(getPendingByParent(manager).get(task.parentSessionId)).toBeUndefined()
  })

  test("should remove toast tracking before notifying completed task", async () => {
    // given
    const { removeTaskCalls, resetToastManager } = createToastRemoveTaskTracker()

    const task: BackgroundTask = {
      id: "task-toast-complete",
      sessionId: "session-toast-complete",
      parentSessionId: "parent-toast-complete",
      parentMessageId: "msg-1",
      description: "toast completion task",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(),
    }

    try {
      // when
      await tryCompleteTaskForTest(manager, task)

      // then
      expect(removeTaskCalls).toContain(task.id)
    } finally {
      resetToastManager()
    }
  })

  test("should release task concurrencyKey when startTask throws after assigning it", async () => {
    // given
    const concurrencyKey = "anthropic/claude-opus-4.7"
    const concurrencyManager = getConcurrencyManager(manager)

    const task = createMockTask({
      id: "task-process-key-concurrency",
      sessionId: "session-process-key-concurrency",
      parentSessionId: "parent-process-key-concurrency",
      status: "pending",
      agent: "explore",
    })
    const input = {
      description: task.description,
      prompt: task.prompt,
      agent: task.agent,
      parentSessionId: task.parentSessionId,
      parentMessageId: task.parentMessageId,
      model: { providerID: "anthropic", modelID: "claude-opus-4.7" },
    }
    getTaskMap(manager).set(task.id, task)
    getQueuesByKey(manager).set(concurrencyKey, [{ task, input }])

    ;(cast<{ startTask: (item: { task: BackgroundTask; input: typeof input }) => Promise<void> }>(manager)).startTask = async (item) => {
      item.task.concurrencyKey = concurrencyKey
      throw new Error("startTask failed after assigning concurrencyKey")
    }

    // when
    await processKeyForTest(manager, concurrencyKey)

    // then
    expect(concurrencyManager.getCount(concurrencyKey)).toBe(0)
    expect(task.concurrencyKey).toBeUndefined()
  })

  test("should mark task as error when startTask throws after session creation", async () => {
    //#given - startTask creates session but fails before sending prompt
    const concurrencyKey = "anthropic/claude-opus-4.7"

    const task = createMockTask({
      id: "task-zombie-session",
      sessionId: "session-zombie-placeholder",
      parentSessionId: "parent-zombie",
      status: "pending",
      agent: "explore",
    })
    delete (task as Partial<BackgroundTask>).sessionId

    const input = {
      description: task.description,
      prompt: task.prompt,
      agent: task.agent,
      parentSessionId: task.parentSessionId,
      parentMessageId: task.parentMessageId,
      model: { providerID: "anthropic", modelID: "claude-opus-4.7" },
    }
    getTaskMap(manager).set(task.id, task)
    getQueuesByKey(manager).set(concurrencyKey, [{ task, input }])

    ;(cast<{ startTask: (item: { task: BackgroundTask; input: typeof input }) => Promise<void> }>(manager)).startTask = async (item) => {
      item.task.status = "running"
      item.task.sessionId = "ses_zombie_child"
      item.task.startedAt = new Date()
      item.task.concurrencyKey = concurrencyKey
      throw new Error("crash between session creation and prompt send")
    }

    //#when
    await processKeyForTest(manager, concurrencyKey)

    //#then - task must be marked as error, not left in running zombie state
    expect(task.status).toBe("error")
    expect(task.error).toContain("crash between session creation and prompt send")
    expect(task.completedAt).toBeDefined()
  })

  test("should release queue slot when queued task is already interrupt", async () => {
    // given
    const concurrencyKey = "anthropic/claude-opus-4.7"
    const concurrencyManager = getConcurrencyManager(manager)

    const task = createMockTask({
      id: "task-process-key-interrupt",
      sessionId: "session-process-key-interrupt",
      parentSessionId: "parent-process-key-interrupt",
      status: "interrupt",
      agent: "explore",
    })
    const input = {
      description: task.description,
      prompt: task.prompt,
      agent: task.agent,
      parentSessionId: task.parentSessionId,
      parentMessageId: task.parentMessageId,
      model: { providerID: "anthropic", modelID: "claude-opus-4.7" },
    }
    getTaskMap(manager).set(task.id, task)
    getQueuesByKey(manager).set(concurrencyKey, [{ task, input }])

    // when
    await processKeyForTest(manager, concurrencyKey)

    // then
    expect(concurrencyManager.getCount(concurrencyKey)).toBe(0)
    expect(getQueuesByKey(manager).get(concurrencyKey)).toEqual([])
  })

  test("should avoid overlapping promptAsync calls when tasks complete concurrently", async () => {
    // given
    type PromptAsyncBody = Record<string, unknown> & { noReply?: boolean }

    let resolveMessages: ((value: { data: unknown[] }) => void) | undefined
    const messagesBarrier = new Promise<{ data: unknown[] }>((resolve) => {
      resolveMessages = resolve
    })

    const promptBodies: PromptAsyncBody[] = []
    let promptInFlight = false
    let rejectedCount = 0
    let promptCallCount = 0

    let releaseFirstPrompt: (() => void) | undefined
    let resolveFirstStarted: (() => void) | undefined
    const firstStarted = new Promise<void>((resolve) => {
      resolveFirstStarted = resolve
    })

    const client = {
      session: {
        prompt: async () => ({}),
        abort: async () => ({}),
        messages: async () => messagesBarrier,
        promptAsync: async (args: { path: { id: string }; body: PromptAsyncBody }) => {
          promptBodies.push(args.body)

          if (!promptInFlight) {
            promptCallCount += 1
            if (promptCallCount === 1) {
              promptInFlight = true
              resolveFirstStarted?.()
              return await new Promise((resolve) => {
                releaseFirstPrompt = () => {
                  promptInFlight = false
                  resolve({})
                }
              })
            }

            return {}
          }

          rejectedCount += 1
          throw new Error("BUSY")
        },
      },
    }

    manager.shutdown()
    manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })

    const parentSessionID = "parent-session"
    const taskA = createMockTask({
      id: "task-a",
      sessionId: "session-a",
      parentSessionId: parentSessionID,
    })
    const taskB = createMockTask({
      id: "task-b",
      sessionId: "session-b",
      parentSessionId: parentSessionID,
    })

    getTaskMap(manager).set(taskA.id, taskA)
    getTaskMap(manager).set(taskB.id, taskB)
    getPendingByParent(manager).set(parentSessionID, new Set([taskA.id, taskB.id]))

    // when
    const completionA = tryCompleteTaskForTest(manager, taskA)
    const completionB = tryCompleteTaskForTest(manager, taskB)
    resolveMessages?.({ data: [] })

    await firstStarted

    // Give the second completion a chance to attempt promptAsync while the first is in-flight.
    // In the buggy implementation, this triggers an overlap and increments rejectedCount.
    for (let i = 0; i < 20; i++) {
      await Promise.resolve()
      if (rejectedCount > 0) break
      if (promptBodies.length >= 2) break
    }

    releaseFirstPrompt?.()
    await Promise.all([completionA, completionB])

    // then
    expect(rejectedCount).toBe(0)
    expect(promptBodies.length).toBe(2)
    expect(promptBodies.filter((body) => body.noReply === false)).toHaveLength(1)
  })
})

describe("BackgroundManager.trackTask", () => {
  let manager: BackgroundManager

  beforeEach(() => {
    // given
    manager = createBackgroundManager()
    stubNotifyParentSession(manager)
  })

  afterEach(() => {
    manager.shutdown()
  })

  test("should not double acquire on duplicate registration", async () => {
    // given
    const input = {
      taskId: "task-1",
      sessionId: "session-1",
      parentSessionId: "parent-session",
      description: "external task",
      agent: "task",
      concurrencyKey: "external-key",
    }

    // when
    await manager.trackTask(input)
    await manager.trackTask(input)

    // then
    const concurrencyManager = getConcurrencyManager(manager)
    expect(concurrencyManager.getCount("external-key")).toBe(1)
    expect(getTaskMap(manager).size).toBe(1)
  })
})

describe("BackgroundManager.resume concurrency key", () => {
  let manager: BackgroundManager

  beforeEach(() => {
    // given
    manager = createBackgroundManager()
    stubNotifyParentSession(manager)
  })

  afterEach(() => {
    manager.shutdown()
  })

  test("should re-acquire using external task concurrency key", async () => {
    // given
    const task = await manager.trackTask({
      taskId: "task-1",
      sessionId: "session-1",
      parentSessionId: "parent-session",
      description: "external task",
      agent: "task",
      concurrencyKey: "external-key",
    })

    await tryCompleteTaskForTest(manager, task)

    // when
    await manager.resume({
      sessionId: "session-1",
      prompt: "resume",
      parentSessionId: "parent-session-2",
      parentMessageId: "msg-2",
    })

    // then
    const concurrencyManager = getConcurrencyManager(manager)
    expect(concurrencyManager.getCount("external-key")).toBe(1)
    expect(task.concurrencyKey).toBe("external-key")
  })
})

describe("BackgroundManager.resume model persistence", () => {
   let manager: BackgroundManager
   let promptCalls: Array<{ path: { id: string }; body: Record<string, unknown> }>

   beforeEach(() => {
     // given
     promptCalls = []
     const promptMock = async (args: { path: { id: string }; body: Record<string, unknown> }) => {
       promptCalls.push(args)
       return {}
     }
     const client = {
       session: {
         prompt: promptMock,
         promptAsync: promptMock,
         abort: async () => ({}),
       },
     }
     manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
     stubNotifyParentSession(manager)
   })

  afterEach(() => {
    clearSessionPromptParams("session-1")
    clearSessionPromptParams("session-advanced")
    clearSessionPromptParams("session-2")
    manager.shutdown()
  })

  test("should pass model when task has a configured model", async () => {
    // given - task with model from category config
    const taskWithModel: BackgroundTask = {
      id: "task-with-model",
      sessionId: "session-1",
      parentSessionId: "parent-session",
      parentMessageId: "msg-1",
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

    // when
    await manager.resume({
      sessionId: "session-1",
      prompt: "continue the work",
      parentSessionId: "parent-session-2",
      parentMessageId: "msg-2",
    })

    // then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0].body.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" })
    expect(promptCalls[0].body.agent).toBe("explore")
  })

  test("should preserve promoted per-model settings when resuming a task", async () => {
    // given - task resumed after fallback promotion
    const taskWithAdvancedModel: BackgroundTask = {
      id: "task-with-advanced-model",
      sessionId: "session-advanced",
      parentSessionId: "parent-session",
      parentMessageId: "msg-1",
      description: "task with advanced model settings",
      prompt: "original prompt",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      model: {
        providerID: "openai",
        modelID: "gpt-5.4-preview",
        variant: "minimal",
        reasoningEffort: "high",
        temperature: 0.25,
        top_p: 0.55,
        maxTokens: 8192,
        thinking: { type: "disabled" },
      },
      concurrencyGroup: "explore",
    }
    getTaskMap(manager).set(taskWithAdvancedModel.id, taskWithAdvancedModel)

    // when
    await manager.resume({
      sessionId: "session-advanced",
      prompt: "continue the work",
      parentSessionId: "parent-session-2",
      parentMessageId: "msg-2",
    })

    // then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0].body.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4-preview",
    })
    expect(promptCalls[0].body.variant).toBe("minimal")
    expect(promptCalls[0].body.options).toBeUndefined()
    expect(getSessionPromptParams("session-advanced")).toEqual({
      temperature: 0.25,
      topP: 0.55,
      maxOutputTokens: 8192,
      options: {
        reasoningEffort: "high",
        thinking: { type: "disabled" },
      },
    })
  })

  test("should NOT pass model when task has no model (backward compatibility)", async () => {
    // given - task without model (default behavior)
    const taskWithoutModel: BackgroundTask = {
      id: "task-no-model",
      sessionId: "session-2",
      parentSessionId: "parent-session",
      parentMessageId: "msg-1",
      description: "task without model",
      prompt: "original prompt",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      concurrencyGroup: "explore",
    }
    getTaskMap(manager).set(taskWithoutModel.id, taskWithoutModel)

    // when
    await manager.resume({
      sessionId: "session-2",
      prompt: "continue the work",
      parentSessionId: "parent-session-2",
      parentMessageId: "msg-2",
    })

    // then
    expect(promptCalls).toHaveLength(1)
    expect("model" in promptCalls[0].body).toBe(false)
    expect(promptCalls[0].body.agent).toBe("explore")
  })
})

describe("BackgroundManager process cleanup", () => {
  test("should remove listeners after last shutdown", () => {
    // given
    resetProcessCleanupState()
    const signals = getCleanupSignals()
    const baseline = getListenerCounts(signals)
    const managerA = createBackgroundManager()
    const managerB = createBackgroundManager()

    // when
    const afterCreate = getListenerCounts(signals)
    managerA.shutdown()
    const afterFirstShutdown = getListenerCounts(signals)
    managerB.shutdown()
    const afterSecondShutdown = getListenerCounts(signals)

    // then
    for (const signal of signals) {
      expect(afterCreate[signal]).toBe(baseline[signal] + 1)
      expect(afterFirstShutdown[signal]).toBe(baseline[signal] + 1)
      expect(afterSecondShutdown[signal]).toBe(baseline[signal])
    }

    resetProcessCleanupState()
  })
})

describe("BackgroundManager - Non-blocking Queue Integration", () => {
  let manager: BackgroundManager
  let mockClient: ReturnType<typeof createMockClient>

    function createMockClient() {
      return {
        session: {
          create: async (_args?: any) => ({ data: { id: `ses_${crypto.randomUUID()}` } }),
          get: async () => ({ data: { directory: "/test/dir" } }),
          prompt: async () => ({}),
          promptAsync: async () => ({}),
          messages: async () => ({ data: [] }),
         todo: async () => ({ data: [] }),
         status: async () => ({ data: {} }),
         abort: async () => ({}),
       },
     }
   }

  function createMockClientWithSessionChain(
      sessions: Record<string, { directory: string; parentID?: string }>,
      options?: { sessionLookupError?: Error }
    ) {
      return {
        session: {
          create: async (_args?: any) => ({ data: { id: `ses_${crypto.randomUUID()}` } }),
          get: async ({ path }: { path: { id: string } }) => {
            if (options?.sessionLookupError) {
              throw options.sessionLookupError
            }

            return {
              data: sessions[path.id] ?? { directory: "/test/dir" },
            }
          },
          prompt: async () => ({}),
          promptAsync: async () => ({}),
          messages: async () => ({ data: [] }),
          todo: async () => ({ data: [] }),
          status: async () => ({ data: {} }),
          abort: async () => ({}),
        },
      }
    }

  beforeEach(() => {
    // given
    mockClient = createMockClient()
    manager = new BackgroundManager({ pluginContext: { client: mockClient, directory: tmpdir() } as unknown as PluginInput })
  })

  afterEach(() => {
    manager.shutdown()
  })

  describe("launch() returns immediately with pending status", () => {
    test("should return task with pending status immediately", async () => {
      // given
      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      // when
      const task = await manager.launch(input)

      // then
      expect(task.status).toBe("pending")
      expect(task.id).toMatch(/^bg_/)
      expect(task.description).toBe("Test task")
      expect(task.agent).toBe("test-agent")
      expect(task.queuedAt).toBeInstanceOf(Date)
      expect(task.startedAt).toBeUndefined()
      expect(task.sessionId).toBeUndefined()
    })

    test("should sanitize wrapped agent names before task creation and queueing", async () => {
      // given
      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "\\hephaestus\\",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      // when
      const task = await manager.launch(input)
      const queueItem = getQueuesByKey(manager).values().next().value?.[0]

      // then
      expect(task.agent).toBe("hephaestus")
      expect(getTaskMap(manager).get(task.id)?.agent).toBe("hephaestus")
      // queueItem may be undefined if the queue was immediately processed
      if (queueItem) {
        expect(queueItem.input.agent).toBe("hephaestus")
      }
    })

    test("should sanitize slash and quote wrapped agent names before task creation and queueing", async () => {
      // given
      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "\"/hephaestus/\"",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      // when
      const task = await manager.launch(input)
      const queueItem = getQueuesByKey(manager).values().next().value?.[0]

      // then
      expect(task.agent).toBe("hephaestus")
      expect(getTaskMap(manager).get(task.id)?.agent).toBe("hephaestus")
      // queueItem may be undefined if the queue was immediately processed
      if (queueItem) {
        expect(queueItem.input.agent).toBe("hephaestus")
      }
    })

    test("should reject wrapper-only agent names after sanitization", async () => {
      // given
      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "\\\"/'\\\"/",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      // when
      const result = manager.launch(input)

      // then
      await expect(result).rejects.toThrow("Agent parameter is required after sanitization")
    })

    test("should initialize attempt state for a newly launched task", async () => {
      // given
      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
        model: {
          providerID: "openai",
          modelID: "gpt-5.4-mini",
          variant: "medium",
        },
      }

      // when
      const task = await manager.launch(input)

      // then
      expect(task.attempts).toHaveLength(1)
      expect(task.currentAttemptID).toBe(task.attempts?.[0]?.attemptId)
      expect(task.attempts?.[0]).toEqual({
        attemptId: task.currentAttemptID,
        attemptNumber: 1,
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        variant: "medium",
        status: "pending",
      })

      expect(task.status).toBe("pending")
      expect(task.model).toEqual(input.model)
      expect(task.queuedAt).toBeInstanceOf(Date)
      expect(task.startedAt).toBeUndefined()
      expect(task.sessionId).toBeUndefined()
    })

  test("should return immediately even with concurrency limit", async () => {
    // given
    const config = { defaultConcurrency: 1 }
    manager.shutdown()
    manager = new BackgroundManager({ pluginContext: { client: mockClient, directory: tmpdir() } as unknown as PluginInput, config: config })

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      // when
      const startTime = Date.now()
      const task1 = await manager.launch(input)
      const task2 = await manager.launch(input)
      const endTime = Date.now()

      // then
      expect(endTime - startTime).toBeLessThan(100)
    expect(task1.status).toBe("pending")
    expect(task2.status).toBe("pending")
  })

  test("should keep agent when launch has model and keep agent without model", async () => {
    // given
    const promptBodies: Array<Record<string, unknown>> = []
    let resolveFirstPromptStarted: (() => void) | undefined
    let resolveSecondPromptStarted: (() => void) | undefined
    const firstPromptStarted = new Promise<void>((resolve) => {
      resolveFirstPromptStarted = resolve
    })
    const secondPromptStarted = new Promise<void>((resolve) => {
      resolveSecondPromptStarted = resolve
    })
    const customClient = {
      session: {
        create: async (_args?: unknown) => ({ data: { id: `ses_${crypto.randomUUID()}` } }),
        get: async () => ({ data: { directory: "/test/dir" } }),
        prompt: async () => ({}),
        promptAsync: async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptBodies.push(args.body)
          if (promptBodies.length === 1) {
            resolveFirstPromptStarted?.()
          }
          if (promptBodies.length === 2) {
            resolveSecondPromptStarted?.()
          }
          return {}
        },
        messages: async () => ({ data: [] }),
        todo: async () => ({ data: [] }),
        status: async () => ({ data: {} }),
        abort: async () => ({}),
      },
    }
    manager.shutdown()
    manager = new BackgroundManager({ pluginContext: { client: customClient, directory: tmpdir() } as unknown as PluginInput })

    const launchInputWithModel = {
      description: "Test task with model",
      prompt: "Do something",
      agent: "test-agent",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
      model: { providerID: "anthropic", modelID: "claude-opus-4.7" },
    }
    const launchInputWithoutModel = {
      description: "Test task without model",
      prompt: "Do something else",
      agent: "test-agent",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
    }

    // when
    const taskWithModel = await manager.launch(launchInputWithModel)
    await firstPromptStarted
    const taskWithoutModel = await manager.launch(launchInputWithoutModel)
    await secondPromptStarted

    // then
    expect(taskWithModel.status).toBe("pending")
    expect(taskWithoutModel.status).toBe("pending")
    expect(promptBodies).toHaveLength(2)
    expect(promptBodies[0].model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4.7" })
    expect(promptBodies[0].agent).toBe("test-agent")
    expect(promptBodies[1].agent).toBe("test-agent")
    expect("model" in promptBodies[1]).toBe(false)
  })

    test("should queue multiple tasks without blocking", async () => {
      // given
      const config = { defaultConcurrency: 2 }
      manager.shutdown()
      manager = new BackgroundManager({ pluginContext: { client: mockClient, directory: tmpdir() } as unknown as PluginInput, config: config })

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      // when
      const tasks = await Promise.all([
        manager.launch(input),
        manager.launch(input),
        manager.launch(input),
        manager.launch(input),
        manager.launch(input),
      ])

      // then
      expect(tasks).toHaveLength(5)
      tasks.forEach(task => {
        expect(task.status).toBe("pending")
        expect(task.queuedAt).toBeInstanceOf(Date)
      })
    })
  })

  describe("task transitions pending→running when slot available", () => {
    test("does not override parent session permission when creating child session", async () => {
      // given
      const createCalls: any[] = []
      const parentPermission = [
        { permission: "question", action: "allow" as const, pattern: "*" },
        { permission: "plan_enter", action: "deny" as const, pattern: "*" },
      ]

      const customClient = {
        session: {
          create: async (args?: any) => {
            createCalls.push(args)
            return { data: { id: `ses_${crypto.randomUUID()}` } }
          },
          get: async () => ({ data: { directory: "/test/dir", permission: parentPermission } }),
          prompt: async () => ({}),
          promptAsync: async () => ({}),
          messages: async () => ({ data: [] }),
          todo: async () => ({ data: [] }),
          status: async () => ({ data: {} }),
          abort: async () => ({}),
        },
      }
      manager.shutdown()
      manager = new BackgroundManager({ pluginContext: { client: customClient, directory: tmpdir() } as unknown as PluginInput, config: {
        defaultConcurrency: 5,
      } })

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      // when
      await manager.launch(input)
      await new Promise(resolve => setTimeout(resolve, 50))

      // then
      expect(createCalls).toHaveLength(1)
      expect(createCalls[0]?.body?.permission).toBeUndefined()
    })

    test("should transition first task to running immediately", async () => {
      // given
      const config = { defaultConcurrency: 5 }
      manager.shutdown()
      manager = new BackgroundManager({ pluginContext: { client: mockClient, directory: tmpdir() } as unknown as PluginInput, config: config })

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      // when
      const task = await manager.launch(input)
      await new Promise(resolve => setTimeout(resolve, 50))

      // then
      const updatedTask = manager.getTask(task.id)
      expect(updatedTask?.status).toBe("running")
      expect(updatedTask?.startedAt).toBeInstanceOf(Date)
      expect(updatedTask?.sessionId).toBeDefined()
      expect(updatedTask?.sessionId).toBeTruthy()
    })

    test("should set startedAt when transitioning to running", async () => {
      // given
      const config = { defaultConcurrency: 5 }
      manager.shutdown()
      manager = new BackgroundManager({ pluginContext: { client: mockClient, directory: tmpdir() } as unknown as PluginInput, config: config })

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      // when
      const task = await manager.launch(input)
      const queuedAt = task.queuedAt

      await new Promise(resolve => setTimeout(resolve, 50))

      // then
      const updatedTask = manager.getTask(task.id)
      expect(updatedTask?.startedAt).toBeInstanceOf(Date)
      if (updatedTask?.startedAt && queuedAt) {
        expect(updatedTask.startedAt.getTime()).toBeGreaterThanOrEqual(queuedAt.getTime())
      }
    })

    test("should track rootSessionID and spawnDepth from the parent chain", async () => {
      // given
      manager.shutdown()
      manager = new BackgroundManager(
        { pluginContext: {
          client: createMockClientWithSessionChain({
            "session-depth-2": { directory: "/test/dir", parentID: "session-depth-1" },
            "session-depth-1": { directory: "/test/dir", parentID: "session-root" },
            "session-root": { directory: "/test/dir" },
          }),
          directory: tmpdir(),
        } as unknown as PluginInput, config: { maxDepth: 3 } },
      )

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "session-depth-2",
        parentMessageId: "parent-message",
      }

      // when
      const task = await manager.launch(input)

      // then
      expect(task.rootSessionId).toBe("session-root")
      expect(task.spawnDepth).toBe(3)
    })

    test("should block launches that exceed maxDepth", async () => {
      // given
      manager.shutdown()
      manager = new BackgroundManager(
        { pluginContext: {
          client: createMockClientWithSessionChain({
            "session-depth-3": { directory: "/test/dir", parentID: "session-depth-2" },
            "session-depth-2": { directory: "/test/dir", parentID: "session-depth-1" },
            "session-depth-1": { directory: "/test/dir", parentID: "session-root" },
            "session-root": { directory: "/test/dir" },
          }),
          directory: tmpdir(),
        } as unknown as PluginInput, config: { maxDepth: 3 } },
      )

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "session-depth-3",
        parentMessageId: "parent-message",
      }

      // when
      const result = manager.launch(input)

      // then
      await expect(result).rejects.toThrow("background_task.maxDepth=3")
    })

    test("allows multiple descendants without a root spawn cap", async () => {
      // given
      manager.shutdown()
      manager = new BackgroundManager(
        { pluginContext: {
          client: createMockClientWithSessionChain({
            "session-root": { directory: "/test/dir" },
          }),
          directory: tmpdir(),
        } as unknown as PluginInput },
      )

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "session-root",
        parentMessageId: "parent-message",
      }

      await manager.launch(input)

      // when
      const result = manager.launch(input)

      // then
      await expect(result).resolves.toBeDefined()
    })

    test("allows spawn assertions after reserveSubagentSpawn without a root spawn cap", async () => {
      // given
      manager.shutdown()
      manager = new BackgroundManager(
        { pluginContext: {
          client: createMockClientWithSessionChain({
            "session-root": { directory: "/test/dir" },
          }),
          directory: tmpdir(),
        } as unknown as PluginInput },
      )

      await manager.reserveSubagentSpawn("session-root")

      // when
      const result = manager.assertCanSpawn("session-root")

      // then
      await expect(result).resolves.toMatchObject({
        rootSessionID: "session-root",
        childDepth: 1,
      })
    })

    test("should fail closed when session lineage lookup fails", async () => {
      // given
      manager.shutdown()
      manager = new BackgroundManager(
        { pluginContext: {
          client: createMockClientWithSessionChain(
            {
              "session-root": { directory: "/test/dir" },
            },
            { sessionLookupError: new Error("session lookup failed") }
          ),
          directory: tmpdir(),
        } as unknown as PluginInput },
      )

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "session-root",
        parentMessageId: "parent-message",
      }

      // when
      const result = manager.launch(input)

      // then
      await expect(result).rejects.toThrow("background_task.maxDepth cannot be enforced safely")
    })

    test("allows replacement launch when a queued task is cancelled before session starts", async () => {
      // given
      manager.shutdown()
      manager = new BackgroundManager(
        { pluginContext: {
          client: createMockClientWithSessionChain({
            "session-root": { directory: "/test/dir" },
          }),
          directory: tmpdir(),
        } as unknown as PluginInput, config: { defaultConcurrency: 1 } },
      )

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "session-root",
        parentMessageId: "parent-message",
      }

      await manager.launch(input)
      const queuedTask = await manager.launch(input)
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(manager.getTask(queuedTask.id)?.status).toBe("pending")

      // when
      const cancelled = manager.cancelPendingTask(queuedTask.id)
      const replacementTask = await manager.launch(input)

      // then
      expect(cancelled).toBe(true)
      expect(replacementTask.status).toBe("pending")
    })

    test("allows retry after session creation fails before session starts", async () => {
      // given
      let createAttempts = 0
      manager.shutdown()
      manager = new BackgroundManager(
        { pluginContext: {
          client: {
            session: {
              create: async () => {
                createAttempts += 1
                if (createAttempts === 1) {
                  return { error: "session create failed", data: undefined }
                }

                return { data: { id: `ses_${crypto.randomUUID()}` } }
              },
              get: async () => ({ data: { directory: "/test/dir" } }),
              prompt: async () => ({}),
              promptAsync: async () => ({}),
              messages: async () => ({ data: [] }),
              todo: async () => ({ data: [] }),
              status: async () => ({ data: {} }),
              abort: async () => ({}),
            },
          },
          directory: tmpdir(),
        } as unknown as PluginInput },
      )

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "session-root",
        parentMessageId: "parent-message",
      }

      await manager.launch(input)
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(createAttempts).toBe(1)

      // when
      const retryTask = await manager.launch(input)

      // then
      expect(retryTask.status).toBe("pending")
    })

    test("should only roll back the failed task reservation once when siblings still exist", async () => {
      // given
      const concurrencyKey = "test-agent"
      const task = createMockTask({
        id: "task-single-reservation-rollback",
        sessionId: "session-single-reservation-rollback",
        parentSessionId: "session-root",
        status: "pending",
        agent: "test-agent",
        rootSessionId: "session-root",
      })
      delete (task as Partial<BackgroundTask>).sessionId

      const input = {
        description: task.description,
        prompt: task.prompt,
        agent: task.agent,
        parentSessionId: task.parentSessionId,
        parentMessageId: task.parentMessageId,
      }

      getTaskMap(manager).set(task.id, task)
      getQueuesByKey(manager).set(concurrencyKey, [{ task, input }])
      getRootDescendantCounts(manager).set("session-root", 2)
      getPreStartDescendantReservations(manager).add(task.id)
      stubNotifyParentSession(manager)

      ;(cast<{
        startTask: (item: { task: BackgroundTask; input: typeof input }) => Promise<void>
      }>(manager)).startTask = async () => {
        throw new Error("session create failed")
      }

      // when
      await processKeyForTest(manager, concurrencyKey)

      // then
      expect(getRootDescendantCounts(manager).get("session-root")).toBe(1)
    })

    test("should keep the next queued task when the first task is cancelled during session creation", async () => {
      // given
      const firstSessionID = "ses-first-cancelled-during-create"
      const secondSessionID = "ses-second-survives-queue"
      let createCallCount = 0
      let resolveFirstCreate: ((value: { data: { id: string } }) => void) | undefined
      let resolveFirstCreateStarted: (() => void) | undefined
      let resolveSecondPromptAsync: (() => void) | undefined
      const firstCreateStarted = new Promise<void>((resolve) => {
        resolveFirstCreateStarted = resolve
      })
      const secondPromptAsyncStarted = new Promise<void>((resolve) => {
        resolveSecondPromptAsync = resolve
      })

      manager.shutdown()
      manager = new BackgroundManager(
        { pluginContext: {
          client: {
            session: {
              create: async () => {
                createCallCount += 1
                if (createCallCount === 1) {
                  resolveFirstCreateStarted?.()
                  return await new Promise<{ data: { id: string } }>((resolve) => {
                    resolveFirstCreate = resolve
                  })
                }

                return { data: { id: secondSessionID } }
              },
              get: async () => ({ data: { directory: "/test/dir" } }),
              prompt: async () => ({}),
              promptAsync: async ({ path }: { path: { id: string } }) => {
                if (path.id === secondSessionID) {
                  resolveSecondPromptAsync?.()
                }

                return {}
              },
              messages: async () => ({ data: [] }),
              todo: async () => ({ data: [] }),
              status: async () => ({ data: {} }),
              abort: async () => ({}),
            },
          },
          directory: tmpdir(),
        } as unknown as PluginInput, config: { defaultConcurrency: 1 } }
      )

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      const firstTask = await manager.launch(input)
      const secondTask = await manager.launch(input)
      await firstCreateStarted

      // when
      const cancelled = await manager.cancelTask(firstTask.id, {
        source: "test",
        abortSession: false,
      })
      resolveFirstCreate?.({ data: { id: firstSessionID } })

      await Promise.race([
        secondPromptAsyncStarted,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 100)),
      ])

      // then
      expect(cancelled).toBe(true)
      expect(createCallCount).toBe(2)
      expect(manager.getTask(firstTask.id)?.status).toBe("cancelled")
      expect(manager.getTask(secondTask.id)?.status).toBe("running")
      expect(manager.getTask(secondTask.id)?.sessionId).toBe(secondSessionID)
    })

    test("should keep sibling launch running when concurrent launches share a parent and the first is cancelled during session creation", async () => {
      // given
      const firstSessionID = "ses-first-concurrent-cancelled"
      const secondSessionID = "ses-second-concurrent-survives"
      let createCallCount = 0
      let resolveFirstCreate: ((value: { data: { id: string } }) => void) | undefined
      let resolveFirstCreateStarted: (() => void) | undefined
      let resolveSecondPromptAsync: (() => void) | undefined
      const firstCreateStarted = new Promise<void>((resolve) => {
        resolveFirstCreateStarted = resolve
      })
      const secondPromptAsyncStarted = new Promise<void>((resolve) => {
        resolveSecondPromptAsync = resolve
      })

      manager.shutdown()
      manager = new BackgroundManager(
        { pluginContext: {
          client: {
            session: {
              create: async () => {
                createCallCount += 1
                if (createCallCount === 1) {
                  resolveFirstCreateStarted?.()
                  return await new Promise<{ data: { id: string } }>((resolve) => {
                    resolveFirstCreate = resolve
                  })
                }

                return { data: { id: secondSessionID } }
              },
              get: async () => ({ data: { directory: "/test/dir" } }),
              prompt: async () => ({}),
              promptAsync: async ({ path }: { path: { id: string } }) => {
                if (path.id === secondSessionID) {
                  resolveSecondPromptAsync?.()
                }

                return {}
              },
              messages: async () => ({ data: [] }),
              todo: async () => ({ data: [] }),
              status: async () => ({ data: {} }),
              abort: async () => ({}),
            },
          },
          directory: tmpdir(),
        } as unknown as PluginInput, config: { defaultConcurrency: 1 } }
      )

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      // when
      const [firstTask, secondTask] = await Promise.all([
        manager.launch(input),
        manager.launch(input),
      ])
      await firstCreateStarted

      const cancelled = await manager.cancelTask(firstTask.id, {
        source: "test",
        abortSession: false,
      })
      resolveFirstCreate?.({ data: { id: firstSessionID } })

      await Promise.race([
        secondPromptAsyncStarted,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 100)),
      ])

      // then
      expect(cancelled).toBe(true)
      expect(createCallCount).toBe(2)
      expect(manager.getTask(firstTask.id)?.status).toBe("cancelled")
      expect(manager.getTask(secondTask.id)?.status).toBe("running")
      expect(manager.getTask(secondTask.id)?.sessionId).toBe(secondSessionID)
    })

    test("should keep task cancelled and abort the session when cancellation wins during session creation", async () => {
      // given
      const createdSessionID = "ses-cancelled-during-create"
      let resolveCreate: ((value: { data: { id: string } }) => void) | undefined
      let resolveCreateStarted: (() => void) | undefined
      let resolveAbortCalled: (() => void) | undefined
      const createStarted = new Promise<void>((resolve) => {
        resolveCreateStarted = resolve
      })
      const abortCalled = new Promise<void>((resolve) => {
        resolveAbortCalled = resolve
      })
      const abortCalls: string[] = []
      const promptAsyncSessionIDs: string[] = []

      manager.shutdown()
      manager = new BackgroundManager(
        { pluginContext: {
          client: {
            session: {
              create: async () => {
                resolveCreateStarted?.()
                return await new Promise<{ data: { id: string } }>((resolve) => {
                  resolveCreate = resolve
                })
              },
              get: async () => ({ data: { directory: "/test/dir" } }),
              prompt: async () => ({}),
              promptAsync: async ({ path }: { path: { id: string } }) => {
                promptAsyncSessionIDs.push(path.id)
                return {}
              },
              messages: async () => ({ data: [] }),
              todo: async () => ({ data: [] }),
              status: async () => ({ data: {} }),
              abort: async ({ path }: { path: { id: string } }) => {
                abortCalls.push(path.id)
                resolveAbortCalled?.()
                return {}
              },
            },
          },
          directory: tmpdir(),
        } as unknown as PluginInput, config: { defaultConcurrency: 1 } }
      )

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      const task = await manager.launch(input)
      await createStarted

      // when
      const cancelled = await manager.cancelTask(task.id, {
        source: "test",
        abortSession: false,
      })
      resolveCreate?.({ data: { id: createdSessionID } })

      await Promise.race([
        abortCalled,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 100)),
      ])
      await flushBackgroundNotifications()

      // then
      const updatedTask = manager.getTask(task.id)
      expect(cancelled).toBe(true)
      expect(updatedTask?.status).toBe("cancelled")
      expect(updatedTask?.sessionId).toBeUndefined()
      expect(promptAsyncSessionIDs).not.toContain(createdSessionID)
      expect(abortCalls).toEqual([createdSessionID])
      expect(getConcurrencyManager(manager).getCount("test-agent")).toBe(0)
    })

    test("should keep task cancelled when cancelled during tmux callback before running state is assigned", async () => {
      // given
      resetClaudeCodeSessionState()
      const originalTmuxEnvironment = process.env.TMUX
      process.env.TMUX = "test-session"

      try {
        const createdSessionID = "ses-cancelled-during-tmux-callback"
        const abortCalls: string[] = []
        const promptAsyncSessionIDs: string[] = []
        let taskID: string | undefined
        let resolveAbortCalled: (() => void) | undefined
        const abortCalled = new Promise<void>((resolve) => {
          resolveAbortCalled = resolve
        })

        manager.shutdown()
        manager = new BackgroundManager(
          { pluginContext: {
            client: {
              session: {
                create: async () => ({ data: { id: createdSessionID } }),
                get: async () => ({ data: { directory: "/test/dir" } }),
                prompt: async () => ({}),
                promptAsync: async ({ path }: { path: { id: string } }) => {
                  promptAsyncSessionIDs.push(path.id)
                  return {}
                },
                messages: async () => ({ data: [] }),
                todo: async () => ({ data: [] }),
                status: async () => ({ data: {} }),
                abort: async ({ path }: { path: { id: string } }) => {
                  abortCalls.push(path.id)
                  resolveAbortCalled?.()
                  return {}
                },
              },
            },
            directory: tmpdir(),
          } as unknown as PluginInput, config: {
            defaultConcurrency: 1,
          }, tmuxConfig: {
              enabled: true,
              layout: "main-vertical",
              main_pane_size: 60,
              main_pane_min_width: 120,
              agent_pane_min_width: 40,
              isolation: "inline",
            },
            onSubagentSessionCreated: async () => {
              const activeTaskID = taskID ?? Array.from(getTaskMap(manager).keys())[0]

              if (!activeTaskID) {
                throw new Error("expected active task during tmux callback")
              }

              await manager.cancelTask(activeTaskID, {
                source: "test",
                abortSession: false,
              })
            }, }
        )

        const input = {
          description: "Test task",
          prompt: "Do something",
          agent: "test-agent",
          parentSessionId: "parent-session",
          parentMessageId: "parent-message",
        }

        const task = await manager.launch(input)
        taskID = task.id

        // when
        await Promise.race([
          abortCalled,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 500)),
        ])
        await flushBackgroundNotifications()

        // then
        const updatedTask = manager.getTask(task.id)
        expect(updatedTask?.status).toBe("cancelled")
        expect(updatedTask?.sessionId).toBeUndefined()
        expect(promptAsyncSessionIDs).not.toContain(createdSessionID)
        expect(abortCalls).toEqual([createdSessionID])
        expect(getConcurrencyManager(manager).getCount("test-agent")).toBe(0)
        expect(getRootDescendantCounts(manager).has("parent-session")).toBe(false)
        expect(subagentSessions.has(createdSessionID)).toBe(false)
      } finally {
        resetClaudeCodeSessionState()
        if (originalTmuxEnvironment === undefined) {
          delete process.env.TMUX
        } else {
          process.env.TMUX = originalTmuxEnvironment
        }
      }
    })

    test("allows relaunch after task completes", async () => {
      manager.shutdown()
      manager = new BackgroundManager(
        { pluginContext: {
          client: createMockClientWithSessionChain({
            "session-root": { directory: "/test/dir" },
          }),
          directory: tmpdir(),
        } as unknown as PluginInput },
      )
      stubNotifyParentSession(manager)

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "session-root",
        parentMessageId: "parent-message",
      }

      const task = await manager.launch(input)
      const internalTask = getTaskMap(manager).get(task.id)!
      internalTask.status = "running"
      internalTask.sessionId = "child-session-complete"
      internalTask.rootSessionId = "session-root"

      // Complete via internal method (session.status events go through the poller, not handleEvent)
      await tryCompleteTaskForTest(manager, internalTask)

      await expect(manager.launch(input)).resolves.toBeDefined()
    })

    test("allows relaunch after running task is cancelled", async () => {
      manager.shutdown()
      manager = new BackgroundManager(
        { pluginContext: {
          client: createMockClientWithSessionChain({
            "session-root": { directory: "/test/dir" },
          }),
          directory: tmpdir(),
        } as unknown as PluginInput },
      )

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "session-root",
        parentMessageId: "parent-message",
      }

      const task = await manager.launch(input)
      const internalTask = getTaskMap(manager).get(task.id)!
      internalTask.status = "running"
      internalTask.sessionId = "child-session-cancel"

      await manager.cancelTask(task.id)

      await expect(manager.launch(input)).resolves.toBeDefined()
    })

    test("allows relaunch after task errors", async () => {
      manager.shutdown()
      manager = new BackgroundManager(
        { pluginContext: {
          client: createMockClientWithSessionChain({
            "session-root": { directory: "/test/dir" },
          }),
          directory: tmpdir(),
        } as unknown as PluginInput },
      )

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "session-root",
        parentMessageId: "parent-message",
      }

      const task = await manager.launch(input)
      const internalTask = getTaskMap(manager).get(task.id)!
      internalTask.status = "running"
      internalTask.sessionId = "child-session-error"

      manager.handleEvent({
        type: "session.error",
        properties: { sessionID: internalTask.sessionId, info: { id: internalTask.sessionId } },
      })
      await new Promise((resolve) => setTimeout(resolve, 100))

      await expect(manager.launch(input)).resolves.toBeDefined()
    })

    test("allows repeated relaunch after pending tasks are cancelled", async () => {
      manager.shutdown()
      manager = new BackgroundManager(
        { pluginContext: {
          client: createMockClientWithSessionChain({
            "session-root": { directory: "/test/dir" },
          }),
          directory: tmpdir(),
        } as unknown as PluginInput },
      )

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "session-root",
        parentMessageId: "parent-message",
      }

      const task1 = await manager.launch(input)
      const task2 = await manager.launch(input)

      await manager.cancelTask(task1.id)
      await manager.cancelTask(task2.id)

      await expect(manager.launch(input)).resolves.toBeDefined()
      await expect(manager.launch(input)).resolves.toBeDefined()
    })
  })

  describe("pending task can be cancelled", () => {
    test("should cancel pending task successfully", async () => {
      // given
      const config = { defaultConcurrency: 1 }
      manager.shutdown()
      manager = new BackgroundManager({ pluginContext: { client: mockClient, directory: tmpdir() } as unknown as PluginInput, config: config })

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      await manager.launch(input)
      const task2 = await manager.launch(input)
      await new Promise(resolve => setTimeout(resolve, 50))

      // when
      const cancelled = manager.cancelPendingTask(task2.id)

      // then
      expect(cancelled).toBe(true)
      const updatedTask2 = manager.getTask(task2.id)
      expect(updatedTask2?.status).toBe("cancelled")
      expect(updatedTask2?.completedAt).toBeInstanceOf(Date)
    })

    test("should not cancel running task", async () => {
      // given
      const config = { defaultConcurrency: 5 }
      manager.shutdown()
      manager = new BackgroundManager({ pluginContext: { client: mockClient, directory: tmpdir() } as unknown as PluginInput, config: config })

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      const task = await manager.launch(input)
      await new Promise(resolve => setTimeout(resolve, 50))

      // when
      const cancelled = manager.cancelPendingTask(task.id)

      // then
      expect(cancelled).toBe(false)
      const updatedTask = manager.getTask(task.id)
      expect(updatedTask?.status).toBe("running")
    })

    test("should remove cancelled task from queue", async () => {
      // given
      const config = { defaultConcurrency: 1 }
      manager.shutdown()
      manager = new BackgroundManager({ pluginContext: { client: mockClient, directory: tmpdir() } as unknown as PluginInput, config: config })

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      await manager.launch(input)
      const task2 = await manager.launch(input)
      const task3 = await manager.launch(input)
      await new Promise(resolve => setTimeout(resolve, 100))

      // when - cancel middle task
      const cancelledTask2 = manager.getTask(task2.id)
      expect(cancelledTask2?.status).toBe("pending")

      manager.cancelPendingTask(task2.id)

      const afterCancel = manager.getTask(task2.id)
      expect(afterCancel?.status).toBe("cancelled")

      // then - verify task3 is still pending (task1 still running)
      const task3BeforeRelease = manager.getTask(task3.id)
      expect(task3BeforeRelease?.status).toBe("pending")
    })
  })

  describe("cancelTask", () => {
    test("should cancel running task and release concurrency", async () => {
      // given
      const manager = createBackgroundManager()

      const concurrencyManager = getConcurrencyManager(manager)
      const concurrencyKey = "test-provider/test-model"
      await concurrencyManager.acquire(concurrencyKey)

      const task = createMockTask({
        id: "task-cancel-running",
        sessionId: "session-cancel-running",
        parentSessionId: "parent-cancel",
        status: "running",
        concurrencyKey,
      })

      getTaskMap(manager).set(task.id, task)
      const pendingByParent = getPendingByParent(manager)
      pendingByParent.set(task.parentSessionId, new Set([task.id]))

      // when
      const cancelled = await manager.cancelTask(task.id, { source: "test" })

      // then
      const updatedTask = manager.getTask(task.id)
      expect(cancelled).toBe(true)
      expect(updatedTask?.status).toBe("cancelled")
      expect(updatedTask?.completedAt).toBeInstanceOf(Date)
      expect(updatedTask?.concurrencyKey).toBeUndefined()
      expect(concurrencyManager.getCount(concurrencyKey)).toBe(0)

      const pendingSet = pendingByParent.get(task.parentSessionId)
      expect(pendingSet?.has(task.id) ?? false).toBe(false)
    })

    test("should remove task from toast manager when notification is skipped", async () => {
      //#given
      const { removeTaskCalls, resetToastManager } = createToastRemoveTaskTracker()
      const manager = createBackgroundManager()
      const task = createMockTask({
        id: "task-cancel-skip-notification",
        sessionId: "session-cancel-skip-notification",
        parentSessionId: "parent-cancel-skip-notification",
        status: "running",
      })
      getTaskMap(manager).set(task.id, task)

      //#when
      const cancelled = await manager.cancelTask(task.id, {
        source: "test",
        skipNotification: true,
      })

      //#then
      expect(cancelled).toBe(true)
      expect(removeTaskCalls).toContain(task.id)

      manager.shutdown()
      resetToastManager()
    })
  })

  describe("multiple keys process in parallel", () => {
    test("should process different concurrency keys in parallel", async () => {
      // given
      const config = { defaultConcurrency: 1 }
      manager.shutdown()
      manager = new BackgroundManager({ pluginContext: { client: mockClient, directory: tmpdir() } as unknown as PluginInput, config: config })

      const input1 = {
        description: "Task 1",
        prompt: "Do something",
        agent: "agent-a",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      const input2 = {
        description: "Task 2",
        prompt: "Do something else",
        agent: "agent-b",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      // when
      const task1 = await manager.launch(input1)
      const task2 = await manager.launch(input2)
      await new Promise(resolve => setTimeout(resolve, 50))

      // then - both should be running despite limit of 1 (different keys)
      const updatedTask1 = manager.getTask(task1.id)
      const updatedTask2 = manager.getTask(task2.id)

      expect(updatedTask1?.status).toBe("running")
      expect(updatedTask2?.status).toBe("running")
    })

    test("should respect per-key concurrency limits", async () => {
      // given
      const config = { defaultConcurrency: 1 }
      manager.shutdown()
      manager = new BackgroundManager({ pluginContext: { client: mockClient, directory: tmpdir() } as unknown as PluginInput, config: config })

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      // when
      const task1 = await manager.launch(input)
      const task2 = await manager.launch(input)
      await new Promise(resolve => setTimeout(resolve, 50))

      // then - same key should respect limit
      const updatedTask1 = manager.getTask(task1.id)
      const updatedTask2 = manager.getTask(task2.id)

      expect(updatedTask1?.status).toBe("running")
      expect(updatedTask2?.status).toBe("pending")
    })

    test("should process model-based keys in parallel", async () => {
      // given
      const config = { defaultConcurrency: 1 }
      manager.shutdown()
      manager = new BackgroundManager({ pluginContext: { client: mockClient, directory: tmpdir() } as unknown as PluginInput, config: config })

      const input1 = {
        description: "Task 1",
        prompt: "Do something",
        agent: "test-agent",
        model: { providerID: "anthropic", modelID: "claude-opus-4.7" },
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      const input2 = {
        description: "Task 2",
        prompt: "Do something else",
        agent: "test-agent",
        model: { providerID: "openai", modelID: "gpt-5.4" },
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      // when
      const task1 = await manager.launch(input1)
      const task2 = await manager.launch(input2)
      await new Promise(resolve => setTimeout(resolve, 50))

      // then - different models should run in parallel
      const updatedTask1 = manager.getTask(task1.id)
      const updatedTask2 = manager.getTask(task2.id)

      expect(updatedTask1?.status).toBe("running")
      expect(updatedTask2?.status).toBe("running")
    })
  })

  describe("TTL uses queuedAt for pending, startedAt for running", () => {
    test("should use queuedAt for pending task TTL", async () => {
      // given
      const config = { defaultConcurrency: 1 }
      manager.shutdown()
      manager = new BackgroundManager({ pluginContext: { client: mockClient, directory: tmpdir() } as unknown as PluginInput, config: config })

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      await manager.launch(input)
      const task2 = await manager.launch(input)
      await new Promise(resolve => setTimeout(resolve, 50))

      // when
      const pendingTask = manager.getTask(task2.id)

      // then
      expect(pendingTask?.status).toBe("pending")
      expect(pendingTask?.queuedAt).toBeInstanceOf(Date)
      expect(pendingTask?.startedAt).toBeUndefined()

      const now = Date.now()
      const age = now - pendingTask!.queuedAt!.getTime()
      expect(age).toBeGreaterThanOrEqual(0)
    })

    test("should use startedAt for running task TTL", async () => {
      // given
      const config = { defaultConcurrency: 5 }
      manager.shutdown()
      manager = new BackgroundManager({ pluginContext: { client: mockClient, directory: tmpdir() } as unknown as PluginInput, config: config })

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      // when
      const task = await manager.launch(input)
      await new Promise(resolve => setTimeout(resolve, 50))

      // then
      const runningTask = manager.getTask(task.id)
      expect(runningTask?.status).toBe("running")
      expect(runningTask?.startedAt).toBeInstanceOf(Date)

      const now = Date.now()
      const age = now - runningTask!.startedAt!.getTime()
      expect(age).toBeGreaterThanOrEqual(0)
    })

    test("should have different timestamps for queuedAt and startedAt", async () => {
      // given
      const config = { defaultConcurrency: 1 }
      manager.shutdown()
      manager = new BackgroundManager({ pluginContext: { client: mockClient, directory: tmpdir() } as unknown as PluginInput, config: config })

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      await manager.launch(input)
      const task2 = await manager.launch(input)

      const queuedAt = task2.queuedAt!

      await new Promise(resolve => setTimeout(resolve, 50))

      const tasks = Array.from(getTaskMap(manager).values())
      const runningTask = tasks.find(t => t.status === "running" && t.id !== task2.id)
      if (runningTask?.concurrencyKey) {
        runningTask.status = "completed"
        getConcurrencyManager(manager).release(runningTask.concurrencyKey)
      }

      await new Promise(resolve => setTimeout(resolve, 100))

      // then
      const startedTask = manager.getTask(task2.id)
      if (startedTask?.status === "running" && startedTask.startedAt) {
        expect(startedTask.startedAt).toBeInstanceOf(Date)
        expect(startedTask.startedAt.getTime()).toBeGreaterThan(queuedAt.getTime())
      }
    })
  })

  describe("manual verification scenario", () => {
    test("should handle 10 tasks with limit 5 returning immediately", async () => {
      // given
      const config = { defaultConcurrency: 5 }
      manager.shutdown()
      manager = new BackgroundManager({ pluginContext: { client: mockClient, directory: tmpdir() } as unknown as PluginInput, config: config })

      const input = {
        description: "Test task",
        prompt: "Do something",
        agent: "test-agent",
        parentSessionId: "parent-session",
        parentMessageId: "parent-message",
      }

      // when
      const startTime = Date.now()
      const tasks = await Promise.all(
        Array.from({ length: 10 }, () => manager.launch(input))
      )
      const endTime = Date.now()

      // then
      expect(endTime - startTime).toBeLessThan(200)
      expect(tasks).toHaveLength(10)
      tasks.forEach(task => {
        expect(task.status).toBe("pending")
        expect(task.id).toMatch(/^bg_/)
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      const updatedTasks = tasks.map(t => manager.getTask(t.id))
      const runningCount = updatedTasks.filter(t => t?.status === "running").length
      const pendingCount = updatedTasks.filter(t => t?.status === "pending").length

      expect(runningCount).toBe(5)
      expect(pendingCount).toBe(5)
    })
  })
})

describe("BackgroundManager.checkAndInterruptStaleTasks", () => {
  const originalDateNow = Date.now
  let fixedTime: number

  beforeEach(() => {
    fixedTime = Date.now()
    spyOn(globalThis.Date, "now").mockReturnValue(fixedTime)
  })

  afterEach(() => {
    Date.now = originalDateNow
  })

   test("should NOT interrupt task running less than 30 seconds (min runtime guard)", async () => {
     const client = {
       session: {
         prompt: async () => ({}),
         promptAsync: async () => ({}),
         abort: async () => ({}),
       },
     }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput, config: { staleTimeoutMs: 180_000 } })

    const task: BackgroundTask = {
      id: "task-1",
      sessionId: "session-1",
      parentSessionId: "parent-1",
      parentMessageId: "msg-1",
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

    getTaskMap(manager).set(task.id, task)

    await manager["checkAndInterruptStaleTasks"](undefined)

    expect(task.status).toBe("running")
  })

   test("should NOT interrupt task with recent lastUpdate", async () => {
     const client = {
       session: {
         prompt: async () => ({}),
         promptAsync: async () => ({}),
         abort: async () => ({}),
       },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput, config: { staleTimeoutMs: 180_000 } })

    const task: BackgroundTask = {
      id: "task-2",
      sessionId: "session-2",
      parentSessionId: "parent-2",
      parentMessageId: "msg-2",
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

    getTaskMap(manager).set(task.id, task)

    await manager["checkAndInterruptStaleTasks"](undefined)

    expect(task.status).toBe("running")
  })

   test("should interrupt task with stale lastUpdate (> 3min)", async () => {
     const client = {
       session: {
         prompt: async () => ({}),
         promptAsync: async () => ({}),
         abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput, config: { staleTimeoutMs: 180_000 } })
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-3",
      sessionId: "session-3",
      parentSessionId: "parent-3",
      parentMessageId: "msg-3",
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

    getTaskMap(manager).set(task.id, task)

    await manager["checkAndInterruptStaleTasks"](undefined)

    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
    expect(task.error).toContain("3min")
    expect(task.completedAt).toBeDefined()
  })

   test("should respect custom staleTimeoutMs config", async () => {
     const client = {
       session: {
         prompt: async () => ({}),
         promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput, config: { staleTimeoutMs: 60_000 } })
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-4",
      sessionId: "session-4",
      parentSessionId: "parent-4",
      parentMessageId: "msg-4",
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

    getTaskMap(manager).set(task.id, task)

    await manager["checkAndInterruptStaleTasks"](undefined)

    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

   test("should release concurrency before abort", async () => {
     const client = {
       session: {
         prompt: async () => ({}),
         promptAsync: async () => ({}),
         abort: async () => ({}),
       },
     }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput, config: { staleTimeoutMs: 180_000 } })
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-5",
      sessionId: "session-5",
      parentSessionId: "parent-5",
      parentMessageId: "msg-5",
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

    getTaskMap(manager).set(task.id, task)

    await manager["checkAndInterruptStaleTasks"](undefined)

    expect(task.concurrencyKey).toBeUndefined()
    expect(task.status).toBe("cancelled")
  })

   test("should handle multiple stale tasks in same poll cycle", async () => {
     const client = {
       session: {
         prompt: async () => ({}),
         promptAsync: async () => ({}),
         abort: async () => ({}),
       },
     }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput, config: { staleTimeoutMs: 180_000 } })
    stubNotifyParentSession(manager)

    const task1: BackgroundTask = {
      id: "task-6",
      sessionId: "session-6",
      parentSessionId: "parent-6",
      parentMessageId: "msg-6",
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
      sessionId: "session-7",
      parentSessionId: "parent-7",
      parentMessageId: "msg-7",
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

    getTaskMap(manager).set(task1.id, task1)
    getTaskMap(manager).set(task2.id, task2)

    await manager["checkAndInterruptStaleTasks"](undefined)

    expect(task1.status).toBe("cancelled")
    expect(task2.status).toBe("cancelled")
  })

   test("should use default timeout when config not provided", async () => {
     const client = {
       session: {
         prompt: async () => ({}),
         promptAsync: async () => ({}),
         abort: async () => ({}),
       },
     }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-8",
      sessionId: "session-8",
      parentSessionId: "parent-8",
      parentMessageId: "msg-8",
      description: "Default timeout",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 50 * 60 * 1000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 46 * 60 * 1000),
      },
    }

    getTaskMap(manager).set(task.id, task)

      await manager["checkAndInterruptStaleTasks"](undefined)

    expect(task.status).toBe("cancelled")
  })

  test("should NOT interrupt task when session is running, even with stale lastUpdate", async () => {
    //#given
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
        get: async () => {
          throw new Error("missing")
        },
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput, config: { staleTimeoutMs: 180_000 } })

    const task: BackgroundTask = {
      id: "task-running-session",
      sessionId: "session-running",
      parentSessionId: "parent-rs",
      parentMessageId: "msg-rs",
      description: "Task with running session",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    }

    getTaskMap(manager).set(task.id, task)

    //#when - session is actively running
    await manager["checkAndInterruptStaleTasks"]({ "session-running": { type: "running" } })

    //#then - task survives because session is running
    expect(task.status).toBe("running")
  })

  test("should interrupt task when session is idle and lastUpdate exceeds stale timeout", async () => {
    //#given
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
        get: async () => {
          throw new Error("missing")
        },
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput, config: { staleTimeoutMs: 180_000 } })
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-idle-session",
      sessionId: "session-idle",
      parentSessionId: "parent-is",
      parentMessageId: "msg-is",
      description: "Task with idle session",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    }

    getTaskMap(manager).set(task.id, task)

    //#when - session is idle
    await manager["checkAndInterruptStaleTasks"]({ "session-idle": { type: "idle" } })

    //#then - killed because session is idle with stale lastUpdate
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  test("should NOT interrupt running session even with very old lastUpdate (no safety net)", async () => {
    //#given
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput, config: { staleTimeoutMs: 180_000 } })

    const task: BackgroundTask = {
      id: "task-long-running",
      sessionId: "session-long",
      parentSessionId: "parent-lr",
      parentMessageId: "msg-lr",
      description: "Long running task",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 900_000),
      progress: {
        toolCalls: 5,
        lastUpdate: new Date(Date.now() - 900_000),
      },
    }

    getTaskMap(manager).set(task.id, task)

    //#when - session is running, lastUpdate 15min old
    await manager["checkAndInterruptStaleTasks"]({ "session-long": { type: "running" } })

    //#then - running sessions are NEVER stale-killed
    expect(task.status).toBe("running")
  })

  test("should NOT interrupt running session with no progress (undefined lastUpdate)", async () => {
    //#given - no progress at all, but session is running
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput, config: { messageStalenessTimeoutMs: 600_000 } })

    const task: BackgroundTask = {
      id: "task-running-no-progress",
      sessionId: "session-rnp",
      parentSessionId: "parent-rnp",
      parentMessageId: "msg-rnp",
      description: "Running no progress",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
      consecutiveMissedPolls: 2,
    }

    getTaskMap(manager).set(task.id, task)

    //#when - session is running despite no progress
    await manager["checkAndInterruptStaleTasks"]({ "session-rnp": { type: "running" } })

    //#then - running sessions are NEVER killed
    expect(task.status).toBe("running")
  })

  test("should interrupt task with no lastUpdate after messageStalenessTimeout", async () => {
    //#given
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        get: async () => ({
          error: { message: "Session not found", status: 404 },
          data: undefined,
        }),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput, config: { messageStalenessTimeoutMs: 600_000 } })
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-no-update",
      sessionId: "session-no-update",
      parentSessionId: "parent-nu",
      parentMessageId: "msg-nu",
      description: "No update task",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
      consecutiveMissedPolls: 2,
    }

    getTaskMap(manager).set(task.id, task)

    //#when - no progress update for 15 minutes
    await manager["checkAndInterruptStaleTasks"]({})

    //#then - killed because session gone from status registry
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("session gone from status registry")
  })

  test("should NOT interrupt task with no lastUpdate within session-gone timeout", async () => {
    //#given
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput, config: { messageStalenessTimeoutMs: 600_000, sessionGoneTimeoutMs: 600_000 } })

    const task: BackgroundTask = {
      id: "task-fresh-no-update",
      sessionId: "session-fresh",
      parentSessionId: "parent-fn",
      parentMessageId: "msg-fn",
      description: "Fresh no-update task",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 5 * 60 * 1000),
      progress: undefined,
    }

    getTaskMap(manager).set(task.id, task)

    //#when - only 5 min since start, within 10min session-gone timeout
    await manager["checkAndInterruptStaleTasks"]({})

    //#then - task survives
    expect(task.status).toBe("running")
  })
})

describe("BackgroundManager.shutdown session abort", () => {
   test("should call session.abort for all running tasks during shutdown", () => {
     // given
     const abortedSessionIDs: string[] = []
     const client = {
       session: {
         prompt: async () => ({}),
         promptAsync: async () => ({}),
         abort: async (args: { path: { id: string } }) => {
           abortedSessionIDs.push(args.path.id)
           return {}
         },
       },
     }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })

    const task1: BackgroundTask = {
      id: "task-1",
      sessionId: "session-1",
      parentSessionId: "parent-1",
      parentMessageId: "msg-1",
      description: "Running task 1",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(),
    }
    const task2: BackgroundTask = {
      id: "task-2",
      sessionId: "session-2",
      parentSessionId: "parent-2",
      parentMessageId: "msg-2",
      description: "Running task 2",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(),
    }

    getTaskMap(manager).set(task1.id, task1)
    getTaskMap(manager).set(task2.id, task2)

    // when
    manager.shutdown()

    // then
    expect(abortedSessionIDs).toContain("session-1")
    expect(abortedSessionIDs).toContain("session-2")
    expect(abortedSessionIDs).toHaveLength(2)
  })

   test("should not call session.abort for completed or cancelled tasks", () => {
     // given
     const abortedSessionIDs: string[] = []
     const client = {
       session: {
         prompt: async () => ({}),
         promptAsync: async () => ({}),
         abort: async (args: { path: { id: string } }) => {
           abortedSessionIDs.push(args.path.id)
           return {}
         },
       },
     }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })

    const completedTask: BackgroundTask = {
      id: "task-completed",
      sessionId: "session-completed",
      parentSessionId: "parent-1",
      parentMessageId: "msg-1",
      description: "Completed task",
      prompt: "Test",
      agent: "test-agent",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    const cancelledTask: BackgroundTask = {
      id: "task-cancelled",
      sessionId: "session-cancelled",
      parentSessionId: "parent-2",
      parentMessageId: "msg-2",
      description: "Cancelled task",
      prompt: "Test",
      agent: "test-agent",
      status: "cancelled",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    const pendingTask: BackgroundTask = {
      id: "task-pending",
      parentSessionId: "parent-3",
      parentMessageId: "msg-3",
      description: "Pending task",
      prompt: "Test",
      agent: "test-agent",
      status: "pending",
      queuedAt: new Date(),
    }

    getTaskMap(manager).set(completedTask.id, completedTask)
    getTaskMap(manager).set(cancelledTask.id, cancelledTask)
    getTaskMap(manager).set(pendingTask.id, pendingTask)

    // when
    manager.shutdown()

    // then
    expect(abortedSessionIDs).toHaveLength(0)
  })

   test("should call onShutdown callback during shutdown", () => {
     // given
     let shutdownCalled = false
     const client = {
       session: {
         prompt: async () => ({}),
         promptAsync: async () => ({}),
         abort: async () => ({}),
       },
     }
    const manager = new BackgroundManager(
      { pluginContext: { client, directory: tmpdir() } as unknown as PluginInput, config: undefined, onShutdown: () => {
          shutdownCalled = true
        }, }
    )

    // when
    manager.shutdown()

    // then
    expect(shutdownCalled).toBe(true)
  })

   test("should not throw when onShutdown callback throws", () => {
     // given
     const client = {
       session: {
         prompt: async () => ({}),
         promptAsync: async () => ({}),
         abort: async () => ({}),
       },
     }
    const manager = new BackgroundManager(
      { pluginContext: { client, directory: tmpdir() } as unknown as PluginInput, config: undefined, onShutdown: () => {
          throw new Error("cleanup failed")
        }, }
    )

    // when / #then
    expect(() => manager.shutdown()).not.toThrow()
  })
})

describe("BackgroundManager.handleEvent - session.deleted cascade", () => {
  test("should cancel descendant tasks and keep them until delayed cleanup", async () => {
    // given
    const manager = createBackgroundManager()
    const parentSessionID = "session-parent"
    const childTask = createMockTask({
      id: "task-child",
      sessionId: "session-child",
      parentSessionId: parentSessionID,
      status: "running",
    })
    const siblingTask = createMockTask({
      id: "task-sibling",
      sessionId: "session-sibling",
      parentSessionId: parentSessionID,
      status: "running",
    })
    const grandchildTask = createMockTask({
      id: "task-grandchild",
      sessionId: "session-grandchild",
      parentSessionId: "session-child",
      status: "pending",
      startedAt: undefined,
      queuedAt: new Date(),
    })
    const unrelatedTask = createMockTask({
      id: "task-unrelated",
      sessionId: "session-unrelated",
      parentSessionId: "other-parent",
      status: "running",
    })

    const taskMap = getTaskMap(manager)
    taskMap.set(childTask.id, childTask)
    taskMap.set(siblingTask.id, siblingTask)
    taskMap.set(grandchildTask.id, grandchildTask)
    taskMap.set(unrelatedTask.id, unrelatedTask)

    const pendingByParent = getPendingByParent(manager)
    pendingByParent.set(parentSessionID, new Set([childTask.id, siblingTask.id]))
    pendingByParent.set("session-child", new Set([grandchildTask.id]))

    // when
    manager.handleEvent({
      type: "session.deleted",
      properties: { info: { id: parentSessionID } },
    })

    // Flush twice: cancelTask now awaits session.abort() before cleanupPendingByParent,
    // so we need additional microtask ticks to let the cascade complete fully.
    await flushBackgroundNotifications()
    await flushBackgroundNotifications()

    // then
    expect(taskMap.has(childTask.id)).toBe(true)
    expect(taskMap.has(siblingTask.id)).toBe(true)
    expect(taskMap.has(grandchildTask.id)).toBe(true)
    expect(taskMap.has(unrelatedTask.id)).toBe(true)
    expect(childTask.status).toBe("cancelled")
    expect(siblingTask.status).toBe("cancelled")
    expect(grandchildTask.status).toBe("cancelled")
    expect(pendingByParent.get(parentSessionID)).toBeUndefined()
    expect(pendingByParent.get("session-child")).toBeUndefined()
    expect(getCompletionTimers(manager).has(childTask.id)).toBe(true)
    expect(getCompletionTimers(manager).has(siblingTask.id)).toBe(true)
    expect(getCompletionTimers(manager).has(grandchildTask.id)).toBe(true)

    manager.shutdown()
  })

  test("should remove cancelled tasks from toast manager while preserving delayed cleanup", async () => {
    //#given
    const { removeTaskCalls, resetToastManager } = createToastRemoveTaskTracker()
    const manager = createBackgroundManager()
    const parentSessionID = "session-parent-toast"
    const childTask = createMockTask({
      id: "task-child-toast",
      sessionId: "session-child-toast",
      parentSessionId: parentSessionID,
      status: "running",
    })
    const grandchildTask = createMockTask({
      id: "task-grandchild-toast",
      sessionId: "session-grandchild-toast",
      parentSessionId: "session-child-toast",
      status: "pending",
      startedAt: undefined,
      queuedAt: new Date(),
    })
    const taskMap = getTaskMap(manager)
    taskMap.set(childTask.id, childTask)
    taskMap.set(grandchildTask.id, grandchildTask)

    //#when
    manager.handleEvent({
      type: "session.deleted",
      properties: { info: { id: parentSessionID } },
    })

    await flushBackgroundNotifications()

    //#then
    expect(removeTaskCalls).toContain(childTask.id)
    expect(removeTaskCalls).toContain(grandchildTask.id)
    expect(getCompletionTimers(manager).has(childTask.id)).toBe(true)
    expect(getCompletionTimers(manager).has(grandchildTask.id)).toBe(true)

    manager.shutdown()
    resetToastManager()
  })

  test("should clean pending notifications for deleted sessions", () => {
    //#given
    const manager = createBackgroundManager()
    const sessionID = "session-pending-notifications"

    manager.queuePendingNotification(sessionID, "<system-reminder>queued</system-reminder>")
    expect(getPendingNotifications(manager).get(sessionID)).toEqual([
      "<system-reminder>queued</system-reminder>",
    ])

    //#when
    manager.handleEvent({
      type: "session.deleted",
      properties: { info: { id: sessionID } },
    })

    //#then
    expect(getPendingNotifications(manager).has(sessionID)).toBe(false)

    manager.shutdown()
  })
})

describe("BackgroundManager.handleEvent - session.error", () => {
  const defaultRetryFallbackChain = [
    { providers: ["anthropic"], model: "claude-opus-4-7", variant: "max" },
    { providers: ["anthropic"], model: "gpt-5.3-codex", variant: "high" },
  ]

  let logCalls: Array<{ message: string; data?: unknown }> = []
  let logSpy: ReturnType<typeof spyOn> | undefined
  let verifySessionExistsSpy: ReturnType<typeof spyOn> | undefined

  beforeEach(() => {
    logCalls = []
    logSpy = spyOn(sharedModule, "log").mockImplementation((message: string, data?: unknown) => {
      logCalls.push({ message, data })
    })
  })

  afterEach(() => {
    logSpy?.mockRestore()
    verifySessionExistsSpy?.mockRestore()
  })

  const mockVerifySessionExists = (manager: BackgroundManager, sessionExists: boolean): void => {
    verifySessionExistsSpy?.mockRestore()
    verifySessionExistsSpy = spyOn(
      cast<{ verifySessionExists: (sessionID: string) => Promise<boolean> }>(manager),
      "verifySessionExists",
    ).mockResolvedValue(sessionExists)
  }

  const stubProcessKey = (manager: BackgroundManager) => {
    ;(cast<{ processKey: (key: string) => Promise<void> }>(manager)).processKey = async () => {}
  }

  const createRetryTask = (manager: BackgroundManager, input: {
    id: string
    sessionId: string
    description: string
    concurrencyKey?: string
    fallbackChain?: typeof defaultRetryFallbackChain
  }) => {
    const task = createMockTask({
      id: input.id,
      sessionId: input.sessionId,
      parentSessionId: "parent-session",
      parentMessageId: "msg-retry",
      description: input.description,
      agent: "sisyphus",
      status: "running",
      concurrencyKey: input.concurrencyKey,
      model: { providerID: "anthropic", modelID: "claude-opus-4.7-thinking" },
      fallbackChain: input.fallbackChain ?? defaultRetryFallbackChain,
      attemptCount: 0,
    })
    getTaskMap(manager).set(task.id, task)
    return task
  }

  test("sets task to error, releases concurrency, and keeps it until delayed cleanup", async () => {
    //#given
    const manager = createBackgroundManager()
    mockVerifySessionExists(manager, false)
    const concurrencyManager = getConcurrencyManager(manager)
    const concurrencyKey = "test-provider/test-model"
    await concurrencyManager.acquire(concurrencyKey)

    const sessionID = "ses_error_1"
    const task = createMockTask({
      id: "task-session-error",
      sessionId: sessionID,
      parentSessionId: "parent-session",
      parentMessageId: "msg-1",
      description: "task that errors",
      agent: "explore",
      status: "running",
      concurrencyKey,
    })
    getTaskMap(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

    //#when
    manager.handleEvent({
      type: "session.error",
      properties: {
        sessionID: sessionID,
        error: {
          name: "UnknownError",
          data: { message: "Model not found: kimi-for-coding/k2p5." },
        },
      },
    })

    await flushBackgroundNotifications()

    //#then
    expect(task.status).toBe("error")
    expect(task.error).toBe("Model not found: kimi-for-coding/k2p5.")
    expect(task.completedAt).toBeInstanceOf(Date)
    expect(concurrencyManager.getCount(concurrencyKey)).toBe(0)
    expect(getTaskMap(manager).has(task.id)).toBe(true)
    expect(getPendingByParent(manager).get(task.parentSessionId)).toBeUndefined()
    expect(getCompletionTimers(manager).has(task.id)).toBe(true)

    manager.shutdown()
  })

  test("should remove errored task from toast manager while preserving delayed cleanup", async () => {
    //#given
    const { removeTaskCalls, resetToastManager } = createToastRemoveTaskTracker()
    const manager = createBackgroundManager()
    mockVerifySessionExists(manager, false)
    const sessionID = "ses_error_toast"
    const task = createMockTask({
      id: "task-session-error-toast",
      sessionId: sessionID,
      parentSessionId: "parent-session",
      status: "running",
    })
    getTaskMap(manager).set(task.id, task)

    //#when
    manager.handleEvent({
      type: "session.error",
      properties: {
        sessionID: sessionID,
        error: { name: "UnknownError", message: "boom" },
      },
    })

    await flushBackgroundNotifications()

    //#then
    expect(removeTaskCalls).toContain(task.id)
    expect(getCompletionTimers(manager).has(task.id)).toBe(true)

    manager.shutdown()
    resetToastManager()
  })

  test("ignores session.error for non-running tasks", () => {
    //#given
    const manager = createBackgroundManager()
    const sessionID = "ses_error_ignored"
    const task = createMockTask({
      id: "task-non-running",
      sessionId: sessionID,
      parentSessionId: "parent-session",
      parentMessageId: "msg-1",
      description: "task already done",
      agent: "explore",
      status: "completed",
    })
    task.completedAt = new Date()
    task.error = "previous"
    getTaskMap(manager).set(task.id, task)

    //#when
    manager.handleEvent({
      type: "session.error",
      properties: {
        sessionID: sessionID,
        error: { name: "UnknownError", message: "should not matter" },
      },
    })

    //#then
    expect(task.status).toBe("completed")
    expect(task.error).toBe("previous")
    expect(getTaskMap(manager).has(task.id)).toBe(true)

    manager.shutdown()
  })

  test("ignores session.error for unknown session", () => {
    //#given
    const manager = createBackgroundManager()

    //#when
    const handler = () =>
      manager.handleEvent({
        type: "session.error",
        properties: {
          sessionID: "ses_unknown",
          error: { name: "UnknownError", message: "Model not found" },
        },
      })

    //#then
    expect(handler).not.toThrow()

    manager.shutdown()
  })

  test("does not terminate task on session.error when session is still alive", async () => {
    //#given
    const manager = createBackgroundManager()
    mockVerifySessionExists(manager, true)

    const task = createMockTask({
      id: "task-session-error-alive",
      sessionId: "ses-alive",
      parentSessionId: "parent-session",
      parentMessageId: "msg-alive",
      description: "task with transient session.error",
      agent: "explore",
      status: "running",
    })
    getTaskMap(manager).set(task.id, task)

    //#when
    manager.handleEvent({
      type: "session.error",
      properties: {
        sessionID: task.sessionId,
        error: {
          name: "UnknownError",
          message: "Out of memory",
        },
      },
    })

    await flushBackgroundNotifications()

    //#then
    expect(task.status).toBe("running")
    expect(task.error).toBeUndefined()
    expect(
      logCalls.some((call) => call.message.includes("session.error received but session still alive")),
    ).toBe(true)

    manager.shutdown()
  })

  test("terminates task on session.error when session is gone", async () => {
    //#given
    const manager = createBackgroundManager()
    mockVerifySessionExists(manager, false)

    const task = createMockTask({
      id: "task-session-error-gone",
      sessionId: "ses-gone",
      parentSessionId: "parent-session",
      parentMessageId: "msg-gone",
      description: "task with fatal session.error",
      agent: "explore",
      status: "running",
    })
    getTaskMap(manager).set(task.id, task)

    //#when
    manager.handleEvent({
      type: "session.error",
      properties: {
        sessionID: task.sessionId,
        error: {
          name: "UnknownError",
          message: "Out of memory",
        },
      },
    })

    await flushBackgroundNotifications()

    //#then
    expect(task.status).toBe("error")
    expect(task.error).toBe("Out of memory")

    manager.shutdown()
  })

  test("completes task on session.idle after transient session.error", async () => {
    //#given
    const sessionID = "ses-alive-idle"
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
        messages: async () => ({
          data: [
            {
              info: { role: "assistant" },
              parts: [{ type: "text", text: "ok" }],
            },
          ],
        }),
        todo: async () => ({ data: [] }),
      },
    }

    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    stubNotifyParentSession(manager)
    mockVerifySessionExists(manager, true)

    const task = createMockTask({
      id: "task-session-error-recovers",
      sessionId: sessionID,
      parentSessionId: "parent-session",
      parentMessageId: "msg-recovers",
      description: "task that recovers after transient error",
      agent: "explore",
      status: "running",
      startedAt: new Date(Date.now() - (MIN_IDLE_TIME_MS + 10)),
    })
    getTaskMap(manager).set(task.id, task)

    //#when
    manager.handleEvent({
      type: "session.error",
      properties: {
        sessionID,
        error: {
          name: "UnknownError",
          message: "Out of memory",
        },
      },
    })
    await flushBackgroundNotifications()
    manager.handleEvent({ type: "session.idle", properties: { sessionID } })
    await new Promise((resolve) => setTimeout(resolve, 10))

    //#then
    expect(task.status).toBe("completed")
    expect(task.error).toBeUndefined()

    manager.shutdown()
  })

  test("retry path releases current concurrency slot and prefers current provider in fallback entry", async () => {
    //#given
    const manager = createBackgroundManager()
    const concurrencyManager = getConcurrencyManager(manager)
    const concurrencyKey = "anthropic/claude-opus-4.7-thinking"
    await concurrencyManager.acquire(concurrencyKey)

    stubProcessKey(manager)

    const sessionID = "ses_error_retry"
    const task = createRetryTask(manager, {
      id: "task-session-error-retry",
      sessionId: sessionID,
      description: "task that should retry",
      concurrencyKey,
      fallbackChain: [
        { providers: ["anthropic"], model: "claude-opus-4-7", variant: "max" },
        { providers: ["anthropic"], model: "claude-opus-4-5", variant: "max" },
      ],
    })

    //#when
    manager.handleEvent({
      type: "session.error",
      properties: {
        sessionID: sessionID,
        error: {
          name: "UnknownError",
          data: {
            message:
              "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4.7-thinking\"}}",
          },
        },
      },
    })

    //#then
    expect(task.status).toBe("pending")
    expect(task.attemptCount).toBe(1)
    expect(task.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4.7",
      variant: "max",
    })
    expect(task.concurrencyKey).toBeUndefined()
    expect(concurrencyManager.getCount(concurrencyKey)).toBe(0)

    manager.shutdown()
  })

  test("retry path triggers on session.status retry events", async () => {
    //#given
    const manager = createBackgroundManager()
    stubProcessKey(manager)

    const sessionID = "ses_status_retry"
    const task = createRetryTask(manager, {
      id: "task-status-retry",
      sessionId: sessionID,
      description: "task that should retry on status",
    })

    //#when
    manager.handleEvent({
      type: "session.status",
      properties: {
        sessionID: sessionID,
        status: {
          type: "retry",
          message: "Provider is overloaded",
        },
      },
    })

    //#then
    expect(task.status).toBe("pending")
    expect(task.attemptCount).toBe(1)
    expect(task.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4.7",
      variant: "max",
    })

    manager.shutdown()
  })

  test("retry path triggers on message.updated assistant error events", async () => {
    //#given
    const manager = createBackgroundManager()
    stubProcessKey(manager)

    const sessionID = "ses_message_updated_retry"
    const task = createRetryTask(manager, {
      id: "task-message-updated-retry",
      sessionId: sessionID,
      description: "task that should retry on message.updated",
    })

    //#when
    const messageInfo = {
      id: "msg_errored",
      sessionID: sessionID,
      role: "assistant",
      error: {
        name: "UnknownError",
        data: {
          message:
              "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4.7-thinking\"}}",
        },
      },
    }

    manager.handleEvent({
      type: "message.updated",
      properties: {
        info: messageInfo,
      },
    })

    //#then
    expect(task.status).toBe("pending")
    expect(task.attemptCount).toBe(1)
    expect(task.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4.7",
      variant: "max",
    })

    manager.shutdown()
  })
})

describe("BackgroundManager queue processing - error tasks are skipped", () => {
  test("does not start tasks with status=error", async () => {
    //#given
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager(
      { pluginContext: { client, directory: tmpdir() } as unknown as PluginInput, config: { defaultConcurrency: 1 } }
    )

    const key = "test-key"
    const task: BackgroundTask = {
      id: "task-error-queued",
      parentSessionId: "parent-session",
      parentMessageId: "msg-1",
      description: "queued error task",
      prompt: "test",
      agent: "test-agent",
      status: "error",
      queuedAt: new Date(),
    }

    const input: import("./types").LaunchInput = {
      description: task.description,
      prompt: task.prompt,
      agent: task.agent,
      parentSessionId: task.parentSessionId,
      parentMessageId: task.parentMessageId,
    }

    let startCalled = false
    ;(cast<{ startTask: (item: unknown) => Promise<void> }>(manager)).startTask = async () => {
      startCalled = true
    }

    getTaskMap(manager).set(task.id, task)
    getQueuesByKey(manager).set(key, [{ task, input }])

    //#when
    await processKeyForTest(manager, key)

    //#then
    expect(startCalled).toBe(false)
    expect(getQueuesByKey(manager).get(key)?.length ?? 0).toBe(0)

    manager.shutdown()
  })
})

describe("BackgroundManager.pruneStaleTasksAndNotifications - removes pruned tasks from queuesByKey", () => {
  test("removes stale pending task from queue", () => {
    //#given
    const manager = createBackgroundManager()
    const queuedAt = new Date(Date.now() - 31 * 60 * 1000)
    const task: BackgroundTask = {
      id: "task-stale-pending",
      parentSessionId: "parent-session",
      parentMessageId: "msg-1",
      description: "stale pending",
      prompt: "test",
      agent: "test-agent",
      status: "pending",
      queuedAt,
    }
    const key = task.agent

    const input: import("./types").LaunchInput = {
      description: task.description,
      prompt: task.prompt,
      agent: task.agent,
      parentSessionId: task.parentSessionId,
      parentMessageId: task.parentMessageId,
    }

    getTaskMap(manager).set(task.id, task)
    getQueuesByKey(manager).set(key, [{ task, input }])

    //#when
    pruneStaleTasksAndNotificationsForTest(manager)

    //#then
    expect(getQueuesByKey(manager).get(key)).toBeUndefined()

    manager.shutdown()
  })

  test("removes stale task from toast manager", async () => {
    //#given
    const { removeTaskCalls, resetToastManager } = createToastRemoveTaskTracker()
    const manager = createBackgroundManager()
    const staleTask = createMockTask({
      id: "task-stale-toast",
      sessionId: "session-stale-toast",
      parentSessionId: "parent-session",
      status: "running",
      startedAt: new Date(Date.now() - 31 * 60 * 1000),
    })
    getTaskMap(manager).set(staleTask.id, staleTask)

    //#when
    pruneStaleTasksAndNotificationsForTest(manager)
    await flushBackgroundNotifications()

    //#then
    expect(removeTaskCalls).toContain(staleTask.id)

    manager.shutdown()
    resetToastManager()
  })

  test("keeps stale task until notification cleanup after notifying parent", async () => {
    //#given
    const notifications: string[] = []
    const { removeTaskCalls, resetToastManager } = createToastRemoveTaskTracker()
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async (args: { path: { id: string }; body: Record<string, unknown> & { noReply?: boolean; parts?: unknown[] } }) => {
          const firstPart = args.body.parts?.[0]
          if (firstPart && typeof firstPart === "object" && "text" in firstPart && typeof firstPart.text === "string") {
            notifications.push(firstPart.text)
          }
          return {}
        },
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    const staleTask = createMockTask({
      id: "task-stale-notify-cleanup",
      sessionId: "session-stale-notify-cleanup",
      parentSessionId: "parent-stale-notify-cleanup",
      status: "running",
      startedAt: new Date(Date.now() - 31 * 60 * 1000),
    })
    getTaskMap(manager).set(staleTask.id, staleTask)
    getPendingByParent(manager).set(staleTask.parentSessionId, new Set([staleTask.id]))

    //#when
    pruneStaleTasksAndNotificationsForTest(manager)
    await flushBackgroundNotifications()

    //#then
    const retainedTask = getTaskMap(manager).get(staleTask.id)
    expect(retainedTask?.status).toBe("error")
    expect(getTaskMap(manager).has(staleTask.id)).toBe(true)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toContain("[ALL BACKGROUND TASKS FINISHED")
    expect(notifications[0]).toContain(staleTask.description)
    expect(getCompletionTimers(manager).has(staleTask.id)).toBe(true)
    expect(removeTaskCalls).toContain(staleTask.id)

    manager.shutdown()
    resetToastManager()
  })
})

describe("BackgroundManager.completionTimers - Memory Leak Fix", () => {
  function setCompletionTimer(manager: BackgroundManager, taskId: string): void {
    const completionTimers = getCompletionTimers(manager)
    const timer = setTimeout(() => {
      completionTimers.delete(taskId)
    }, 5 * 60 * 1000)
    completionTimers.set(taskId, timer)
  }

  test("should have completionTimers Map initialized", () => {
    // given
    const manager = createBackgroundManager()

    // when
    const completionTimers = getCompletionTimers(manager)

    // then
    expect(completionTimers).toBeDefined()
    expect(completionTimers).toBeInstanceOf(Map)
    expect(completionTimers.size).toBe(0)

    manager.shutdown()
  })

  test("should start per-task cleanup timers independently of sibling completion", async () => {
    // given
    const client = {
      session: {
        prompt: async () => ({}),
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    const taskA: BackgroundTask = {
      id: "task-timer-a",
      sessionId: "session-timer-a",
      parentSessionId: "parent-session",
      parentMessageId: "msg-a",
      description: "Task A",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    const taskB: BackgroundTask = {
      id: "task-timer-b",
      sessionId: "session-timer-b",
      parentSessionId: "parent-session",
      parentMessageId: "msg-b",
      description: "Task B",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    getTaskMap(manager).set(taskA.id, taskA)
    getTaskMap(manager).set(taskB.id, taskB)
    ;(cast<{ pendingByParent: Map<string, Set<string>> }>(manager)).pendingByParent.set(
      "parent-session",
      new Set([taskA.id, taskB.id])
    )

    // when
    await (cast<{ notifyParentSession: (task: BackgroundTask) => Promise<void> }>(manager))
      .notifyParentSession(taskA)

    // then
    const completionTimers = getCompletionTimers(manager)
    expect(completionTimers.size).toBe(1)

    // when
    await (cast<{ notifyParentSession: (task: BackgroundTask) => Promise<void> }>(manager))
      .notifyParentSession(taskB)

    // then
    expect(completionTimers.size).toBe(2)
    expect(completionTimers.has(taskA.id)).toBe(true)
    expect(completionTimers.has(taskB.id)).toBe(true)

    manager.shutdown()
  })

  test("should clear all completion timers on shutdown", () => {
    // given
    const manager = createBackgroundManager()
    setCompletionTimer(manager, "task-1")
    setCompletionTimer(manager, "task-2")

    const completionTimers = getCompletionTimers(manager)
    expect(completionTimers.size).toBe(2)

    // when
    manager.shutdown()

    // then
    expect(completionTimers.size).toBe(0)
  })

  test("should preserve cleanup timer when terminal task session is deleted", () => {
    // given
    const manager = createBackgroundManager()
    const task: BackgroundTask = {
      id: "task-timer-4",
      sessionId: "session-timer-4",
      parentSessionId: "parent-session",
      parentMessageId: "msg-1",
      description: "Test task",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
    }
    getTaskMap(manager).set(task.id, task)
    setCompletionTimer(manager, task.id)

    const completionTimers = getCompletionTimers(manager)
    expect(completionTimers.size).toBe(1)

    // when
    manager.handleEvent({
      type: "session.deleted",
      properties: {
        info: { id: "session-timer-4" },
      },
    })

    // then
    expect(completionTimers.has(task.id)).toBe(true)

    manager.shutdown()
  })

  test("should not leak timers across multiple shutdown calls", () => {
    // given
    const manager = createBackgroundManager()
    setCompletionTimer(manager, "task-1")

    // when
    manager.shutdown()
    manager.shutdown()

    // then
    const completionTimers = getCompletionTimers(manager)
    expect(completionTimers.size).toBe(0)
  })
})

describe("BackgroundManager.handleEvent - early session.idle deferral", () => {
  test("should defer and retry when session.idle fires before MIN_IDLE_TIME_MS", async () => {
    //#given - a running task started less than MIN_IDLE_TIME_MS ago
    const sessionID = "session-early-idle"
    const messagesCalls: string[] = []
    const realDateNow = Date.now
    const baseNow = realDateNow()

     const client = {
       session: {
         prompt: async () => ({}),
         promptAsync: async () => ({}),
         abort: async () => ({}),
         messages: async (args: { path: { id: string } }) => {
           messagesCalls.push(args.path.id)
           return {
             data: [
               {
                 info: { role: "assistant" },
                 parts: [{ type: "text", text: "ok" }],
               },
             ],
          }
        },
        todo: async () => ({ data: [] }),
      },
    }

    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-early-idle",
      sessionId: sessionID,
      parentSessionId: "parent-session",
      parentMessageId: "msg-1",
      description: "early idle task",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(baseNow),
    }

    getTaskMap(manager).set(task.id, task)

    //#when - session.idle fires
    try {
      Date.now = () => baseNow + (MIN_IDLE_TIME_MS - 100)
      manager.handleEvent({ type: "session.idle", properties: { sessionID } })

      // Advance time so deferred callback (if any) sees elapsed >= MIN_IDLE_TIME_MS
      Date.now = () => baseNow + (MIN_IDLE_TIME_MS + 10)

      //#then - idle should be deferred (not dropped), and task should eventually complete
      expect(task.status).toBe("running")
      await new Promise((resolve) => setTimeout(resolve, 220))
      expect(task.status).toBe("completed")
      expect(messagesCalls).toEqual([sessionID])
    } finally {
      Date.now = realDateNow
      manager.shutdown()
    }
  })

  test("should not defer when session.idle fires after MIN_IDLE_TIME_MS", async () => {
     //#given - a running task started more than MIN_IDLE_TIME_MS ago
     const sessionID = "session-late-idle"
     const client = {
       session: {
         prompt: async () => ({}),
         promptAsync: async () => ({}),
         abort: async () => ({}),
         messages: async () => ({
           data: [
             {
               info: { role: "assistant" },
               parts: [{ type: "text", text: "ok" }],
             },
           ],
         }),
         todo: async () => ({ data: [] }),
       },
     }

    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-late-idle",
      sessionId: sessionID,
      parentSessionId: "parent-session",
      parentMessageId: "msg-1",
      description: "late idle task",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(Date.now() - (MIN_IDLE_TIME_MS + 10)),
    }

    getTaskMap(manager).set(task.id, task)

    //#when
    manager.handleEvent({ type: "session.idle", properties: { sessionID } })

    //#then - should be processed immediately
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(task.status).toBe("completed")

    manager.shutdown()
  })

  test("should not process deferred idle if task already completed by other means", async () => {
    //#given - a running task
    const sessionID = "session-deferred-noop"
    let messagesCallCount = 0
    const realDateNow = Date.now
    const baseNow = realDateNow()

     const client = {
       session: {
         prompt: async () => ({}),
         promptAsync: async () => ({}),
         abort: async () => ({}),
         messages: async () => {
           messagesCallCount += 1
           return {
             data: [
               {
                 info: { role: "assistant" },
                 parts: [{ type: "text", text: "ok" }],
               },
             ],
           }
        },
        todo: async () => ({ data: [] }),
      },
    }

    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    stubNotifyParentSession(manager)

    const remainingMs = 120
    const task: BackgroundTask = {
      id: "task-deferred-noop",
      sessionId: sessionID,
      parentSessionId: "parent-session",
      parentMessageId: "msg-1",
      description: "deferred noop task",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(baseNow),
    }
    getTaskMap(manager).set(task.id, task)

    //#when - session.idle fires early, then task completes via another path before defer timer
    try {
      Date.now = () => baseNow + (MIN_IDLE_TIME_MS - remainingMs)
      manager.handleEvent({ type: "session.idle", properties: { sessionID } })
      expect(messagesCallCount).toBe(0)

      await tryCompleteTaskForTest(manager, task)
      expect(task.status).toBe("completed")

      // Advance time so deferred callback (if any) sees elapsed >= MIN_IDLE_TIME_MS
      Date.now = () => baseNow + (MIN_IDLE_TIME_MS + 10)

      //#then - deferred callback should be a no-op
      await new Promise((resolve) => setTimeout(resolve, remainingMs + 80))
      expect(task.status).toBe("completed")
      expect(messagesCallCount).toBe(0)
    } finally {
      Date.now = realDateNow
      manager.shutdown()
    }
  })
})

describe("BackgroundManager.handleEvent - non-tool event lastUpdate", () => {
  test("should update lastUpdate on text-type message.part.updated event", () => {
    //#given - a running task with stale lastUpdate
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })

    const oldUpdate = new Date(Date.now() - 300_000)
    const task: BackgroundTask = {
      id: "task-text-1",
      sessionId: "session-text-1",
      parentSessionId: "parent-1",
      parentMessageId: "msg-1",
      description: "Thinking task",
      prompt: "Think deeply",
      agent: "oracle",
      status: "running",
      startedAt: new Date(Date.now() - 600_000),
      progress: {
        toolCalls: 2,
        lastUpdate: oldUpdate,
      },
    }
    getTaskMap(manager).set(task.id, task)

    //#when - a text-type message.part.updated event arrives
    manager.handleEvent({
      type: "message.part.updated",
      properties: { sessionID: "session-text-1", type: "text" },
    })

    //#then - lastUpdate should be refreshed, toolCalls should NOT change
    expect(task.progress!.lastUpdate.getTime()).toBeGreaterThan(oldUpdate.getTime())
    expect(task.progress!.toolCalls).toBe(2)
  })

  test("should update lastUpdate on thinking-type message.part.updated event", () => {
    //#given - a running task with stale lastUpdate
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })

    const oldUpdate = new Date(Date.now() - 300_000)
    const task: BackgroundTask = {
      id: "task-thinking-1",
      sessionId: "session-thinking-1",
      parentSessionId: "parent-1",
      parentMessageId: "msg-1",
      description: "Reasoning task",
      prompt: "Reason about architecture",
      agent: "oracle",
      status: "running",
      startedAt: new Date(Date.now() - 600_000),
      progress: {
        toolCalls: 0,
        lastUpdate: oldUpdate,
      },
    }
    getTaskMap(manager).set(task.id, task)

    //#when - a thinking-type message.part.updated event arrives
    manager.handleEvent({
      type: "message.part.updated",
      properties: { sessionID: "session-thinking-1", type: "thinking" },
    })

    //#then - lastUpdate should be refreshed, toolCalls should remain 0
    expect(task.progress!.lastUpdate.getTime()).toBeGreaterThan(oldUpdate.getTime())
    expect(task.progress!.toolCalls).toBe(0)
  })

  test("should initialize progress on first non-tool event", () => {
    //#given - a running task with NO progress field
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })

    const task: BackgroundTask = {
      id: "task-init-1",
      sessionId: "session-init-1",
      parentSessionId: "parent-1",
      parentMessageId: "msg-1",
      description: "New task",
      prompt: "Start thinking",
      agent: "oracle",
      status: "running",
      startedAt: new Date(Date.now() - 60_000),
    }
    getTaskMap(manager).set(task.id, task)

    //#when - a text-type event arrives before any tool call
    manager.handleEvent({
      type: "message.part.updated",
      properties: { sessionID: "session-init-1", type: "text" },
    })

    //#then - progress should be initialized with toolCalls: 0 and fresh lastUpdate
    expect(task.progress).toBeDefined()
    expect(task.progress!.toolCalls).toBe(0)
    expect(task.progress!.lastUpdate.getTime()).toBeGreaterThan(Date.now() - 5000)
  })

  test("should NOT mark thinking model as stale when text events refresh lastUpdate", async () => {
    //#given - a running task where text events keep lastUpdate fresh
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput, config: { staleTimeoutMs: 180_000 } })
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-alive-1",
      sessionId: "session-alive-1",
      parentSessionId: "parent-1",
      parentMessageId: "msg-1",
      description: "Long thinking task",
      prompt: "Deep reasoning",
      agent: "oracle",
      status: "running",
      startedAt: new Date(Date.now() - 600_000),
      progress: {
        toolCalls: 0,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    }
    getTaskMap(manager).set(task.id, task)

    //#when - a text event arrives, then stale check runs
    manager.handleEvent({
      type: "message.part.updated",
      properties: { sessionID: "session-alive-1", type: "text" },
    })
    await manager["checkAndInterruptStaleTasks"](undefined)

    //#then - task should still be running (text event refreshed lastUpdate)
    expect(task.status).toBe("running")
  })

  test("should refresh lastUpdate on message.part.delta events (OpenCode >=1.2.0)", async () => {
    //#given - a running task with stale lastUpdate
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput, config: { staleTimeoutMs: 180_000 } })
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-delta-1",
      sessionId: "session-delta-1",
      parentSessionId: "parent-1",
      parentMessageId: "msg-1",
      description: "Reasoning task with delta events",
      prompt: "Extended thinking",
      agent: "oracle",
      status: "running",
      startedAt: new Date(Date.now() - 600_000),
      progress: {
        toolCalls: 0,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    }
    getTaskMap(manager).set(task.id, task)

    //#when - a message.part.delta event arrives (reasoning-delta or text-delta in OpenCode >=1.2.0)
    manager.handleEvent({
      type: "message.part.delta",
      properties: { sessionID: "session-delta-1", field: "text", delta: "thinking..." },
    })
    await manager["checkAndInterruptStaleTasks"](undefined)

    //#then - task should still be running (delta event refreshed lastUpdate)
    expect(task.status).toBe("running")
  })

  test("should complete idle task without fetching messages after output event was observed", async () => {
    //#given - a running task with observed output from message part events
    let messagesCallCount = 0
    let todoCallCount = 0
    const sessionID = "session-output-cached-idle"
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
        messages: async () => {
          messagesCallCount += 1
          return {
            data: [
              {
                info: { role: "assistant" },
                parts: [{ type: "text", text: "ok" }],
              },
            ],
          }
        },
        todo: async () => {
          todoCallCount += 1
          return { data: [] }
        },
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-output-cached-idle",
      sessionId: sessionID,
      parentSessionId: "parent-session",
      parentMessageId: "msg-1",
      description: "idle cached output task",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(Date.now() - (MIN_IDLE_TIME_MS + 10)),
    }
    getTaskMap(manager).set(task.id, task)

    manager.handleEvent({
      type: "message.part.updated",
      properties: { sessionID: sessionID, type: "text" },
    })

    //#when - session.idle fires after output event was already observed
    manager.handleEvent({ type: "session.idle", properties: { sessionID } })

    //#then - task completes without refetching session.messages
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(task.status).toBe("completed")
    expect(messagesCallCount).toBe(0)
    expect(todoCallCount).toBe(1)

    manager.shutdown()
  })
})

describe("BackgroundManager regression fixes - resume and aborted notification", () => {
  test("should keep resumed task in memory after previous completion timer deadline", async () => {
    //#given
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })

    const task: BackgroundTask = {
      id: "task-resume-timer-regression",
      sessionId: "session-resume-timer-regression",
      parentSessionId: "parent-session",
      parentMessageId: "msg-1",
      description: "resume timer regression",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      concurrencyGroup: "explore",
    }
    getTaskMap(manager).set(task.id, task)

    const completionTimers = getCompletionTimers(manager)
    const timer = setTimeout(() => {
      completionTimers.delete(task.id)
      getTaskMap(manager).delete(task.id)
    }, 25)
    completionTimers.set(task.id, timer)

    //#when
    await manager.resume({
      sessionId: "session-resume-timer-regression",
      prompt: "resume task",
      parentSessionId: "parent-session-2",
      parentMessageId: "msg-2",
    })
    await new Promise((resolve) => setTimeout(resolve, 60))

    //#then
    expect(getTaskMap(manager).has(task.id)).toBe(true)
    expect(completionTimers.has(task.id)).toBe(false)

    manager.shutdown()
  })

  test("should start cleanup timer even when promptAsync aborts", async () => {
    //#given
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => {
          const error = new Error("User aborted")
          error.name = "MessageAbortedError"
          throw error
        },
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    const task: BackgroundTask = {
      id: "task-aborted-cleanup-regression",
      sessionId: "session-aborted-cleanup-regression",
      parentSessionId: "parent-session",
      parentMessageId: "msg-1",
      description: "aborted prompt cleanup regression",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    getTaskMap(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

    //#when
    await (cast<{ notifyParentSession: (task: BackgroundTask) => Promise<void> }>(manager)).notifyParentSession(task)

    //#then
    expect(getCompletionTimers(manager).has(task.id)).toBe(true)

    manager.shutdown()
  })
})

describe("BackgroundManager - tool permission spread order", () => {
  test("startTask respects explore agent restrictions", async () => {
    //#given
    let capturedTools: Record<string, unknown> | undefined
    const client = {
      session: {
        get: async () => ({ data: { directory: "/test/dir" } }),
        create: async () => ({ data: { id: "session-1" } }),
        promptAsync: async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          capturedTools = args.body.tools as Record<string, unknown>
          return {}
        },
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    const task: BackgroundTask = {
      id: "task-1",
      status: "pending",
      queuedAt: new Date(),
      description: "test task",
      prompt: "test prompt",
      agent: "explore",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
    }
    const input: import("./types").LaunchInput = {
      description: task.description,
      prompt: task.prompt,
      agent: task.agent,
      parentSessionId: task.parentSessionId,
      parentMessageId: task.parentMessageId,
    }

    //#when
    await (cast<{ startTask: (item: { task: BackgroundTask; input: import("./types").LaunchInput }) => Promise<void> }>(manager))
      .startTask({ task, input })

    //#then
    expect(capturedTools).toBeDefined()
    expect(capturedTools?.call_omo_agent).toBe(false)
    expect(capturedTools?.task).toBe(false)
    expect(capturedTools?.write).toBe(false)
    expect(capturedTools?.edit).toBe(false)

    manager.shutdown()
  })

  test("startTask keeps agent when explicit model is configured", async () => {
    //#given
    const promptCalls: Array<{ path: { id: string }; body: Record<string, unknown> }> = []
    const client = {
      session: {
        get: async () => ({ data: { directory: "/test/dir" } }),
        create: async () => ({ data: { id: "session-1" } }),
        promptAsync: async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push(args)
          return {}
        },
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    const task: BackgroundTask = {
      id: "task-explicit-model",
      status: "pending",
      queuedAt: new Date(),
      description: "test task",
      prompt: "test prompt",
      agent: "sisyphus-junior",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
      model: { providerID: "openai", modelID: "gpt-5.4", variant: "medium" },
    }
    const input: import("./types").LaunchInput = {
      description: task.description,
      prompt: task.prompt,
      agent: task.agent,
      parentSessionId: task.parentSessionId,
      parentMessageId: task.parentMessageId,
      model: task.model,
    }

    //#when
    await (cast<{ startTask: (item: { task: BackgroundTask; input: import("./types").LaunchInput }) => Promise<void> }>(manager))
      .startTask({ task, input })

    //#then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0].body.agent).toBe("sisyphus-junior")
    expect(promptCalls[0].body.model).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
    expect(promptCalls[0].body.variant).toBe("medium")

    manager.shutdown()
  })

  test("resume respects explore agent restrictions", async () => {
    //#given
    let capturedTools: Record<string, unknown> | undefined
    const client = {
      session: {
        promptAsync: async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          capturedTools = args.body.tools as Record<string, unknown>
          return {}
        },
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    const task: BackgroundTask = {
      id: "task-2",
      sessionId: "session-2",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
      description: "resume task",
      prompt: "resume prompt",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    getTaskMap(manager).set(task.id, task)

    //#when
    await manager.resume({
      sessionId: "session-2",
      prompt: "continue",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
    })

    //#then
    expect(capturedTools).toBeDefined()
    expect(capturedTools?.call_omo_agent).toBe(false)
    expect(capturedTools?.task).toBe(false)
    expect(capturedTools?.write).toBe(false)
    expect(capturedTools?.edit).toBe(false)

    manager.shutdown()
  })

  test("resume keeps agent when explicit model is configured", async () => {
    //#given
    let promptCall: { path: { id: string }; body: Record<string, unknown> } | undefined
    const client = {
      session: {
        promptAsync: async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCall = args
          return {}
        },
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    const task: BackgroundTask = {
      id: "task-explicit-model-resume",
      sessionId: "session-3",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
      description: "resume task",
      prompt: "resume prompt",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
    }
    getTaskMap(manager).set(task.id, task)

    //#when
    await manager.resume({
      sessionId: "session-3",
      prompt: "continue",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
    })

    //#then
    expect(promptCall).toBeDefined()
    expect(promptCall?.body.agent).toBe("explore")
    expect(promptCall?.body.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" })

    manager.shutdown()
  })
})

describe("BackgroundManager.launch - attempt state initialization", () => {
  test("newly launched task has attempt state with attemptNumber 1 and currentAttemptID pointing at it", async () => {
    //#given
    const manager = createBackgroundManager()
    ;(cast<{
      reserveSubagentSpawn: () => Promise<{
        spawnContext: { rootSessionID: string; parentDepth: number; childDepth: number }
        descendantCount: number
        commit: () => number
        rollback: () => void
      }>
    }>(manager)).reserveSubagentSpawn = async () => ({
      spawnContext: { rootSessionID: "parent-session", parentDepth: 0, childDepth: 1 },
      descendantCount: 1,
      commit: () => 1,
      rollback: () => {},
    })

    //#when
    const task = await manager.launch({
      description: "attempt state test",
      prompt: "do something",
      agent: "explore",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
      model: { providerID: "anthropic", modelID: "claude-haiku-4.5" },
    })

    //#then
    const stored = getTaskMap(manager).get(task.id)

    expect(stored?.attempts).toBeDefined()
    expect(stored?.attempts).toHaveLength(1)

    const firstAttempt = stored?.attempts?.[0]
    expect(firstAttempt?.attemptNumber).toBe(1)
    expect(firstAttempt?.status).toBe("pending")
    expect(firstAttempt?.providerId).toBe("anthropic")
    expect(firstAttempt?.modelId).toBe("claude-haiku-4.5")

    expect(stored?.currentAttemptID).toBeDefined()
    expect(stored?.currentAttemptID).toBe(firstAttempt?.attemptId)

    expect(stored?.status).toBeDefined()
    expect(stored?.model).toBeDefined()
    expect(stored?.parentSessionId).toBe("parent-session")

    manager.shutdown()
  })
})

describe("BackgroundManager attempt lifecycle bindings", () => {
  test("startTask binds the created session to the queued attempt ID and mirrors task projection", async () => {
    //#given
    const client = {
      session: {
        get: async () => ({ data: { directory: "/test/dir" } }),
        create: async () => ({ data: { id: "session-attempt-2" } }),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    const task: BackgroundTask = {
      id: "task-attempt-binding",
      status: "pending",
      queuedAt: new Date(),
      description: "retry binding task",
      prompt: "continue",
      agent: "sisyphus-junior",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
      model: { providerID: "anthropic", modelID: "claude-haiku-4.5", variant: "max" },
      attempts: [
        {
          attemptId: "attempt-1",
          attemptNumber: 1,
          sessionId: "session-attempt-1",
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          status: "error",
          error: "first attempt failed",
          startedAt: new Date("2026-04-27T00:00:00.000Z"),
          completedAt: new Date("2026-04-27T00:00:05.000Z"),
        },
        {
          attemptId: "attempt-2",
          attemptNumber: 2,
          providerId: "anthropic",
          modelId: "claude-haiku-4.5",
          variant: "max",
          status: "pending",
        },
      ],
      currentAttemptID: "attempt-2",
      attemptCount: 1,
    }
    const input: import("./types").LaunchInput = {
      description: task.description,
      prompt: task.prompt,
      agent: task.agent,
      parentSessionId: task.parentSessionId,
      parentMessageId: task.parentMessageId,
      model: task.model,
    }

    //#when
    await (cast<{
      startTask: (item: { task: BackgroundTask; input: import("./types").LaunchInput; attemptID: string }) => Promise<void>
    }>(manager)).startTask({ task, input, attemptID: "attempt-2" })

    //#then
    const activeAttempt = task.attempts?.find((attempt) => attempt.attemptId === "attempt-2")
    expect(activeAttempt).toBeDefined()
    expect(activeAttempt?.sessionId).toBe("session-attempt-2")
    expect(activeAttempt?.status).toBe("running")
    expect(activeAttempt?.startedAt).toBeInstanceOf(Date)
    expect(task.currentAttemptID).toBe("attempt-2")
    expect(task.sessionId).toBe("session-attempt-2")
    expect(task.status).toBe("running")
    expect(task.attempts?.[0]).toMatchObject({
      attemptId: "attempt-1",
      sessionId: "session-attempt-1",
      status: "error",
      error: "first attempt failed",
    })

    manager.shutdown()
  })

  test("historical attempt session IDs resolve to the task while stale session.error events leave the current attempt unchanged", async () => {
    //#given
    const manager = createBackgroundManager()
    const task: BackgroundTask = {
      id: "task-stale-session-event",
      status: "running",
      queuedAt: new Date("2026-04-27T00:00:00.000Z"),
      startedAt: new Date("2026-04-27T00:00:10.000Z"),
      sessionId: "session-attempt-2",
      description: "ignore stale retry events",
      prompt: "continue",
      agent: "explore",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
      model: { providerID: "anthropic", modelID: "claude-haiku-4.5" },
      attempts: [
        {
          attemptId: "attempt-1",
          attemptNumber: 1,
          sessionId: "session-attempt-1",
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          status: "error",
          error: "first attempt failed",
          startedAt: new Date("2026-04-27T00:00:00.000Z"),
          completedAt: new Date("2026-04-27T00:00:05.000Z"),
        },
        {
          attemptId: "attempt-2",
          attemptNumber: 2,
          sessionId: "session-attempt-2",
          providerId: "anthropic",
          modelId: "claude-haiku-4.5",
          status: "running",
          startedAt: new Date("2026-04-27T00:00:10.000Z"),
        },
      ],
      currentAttemptID: "attempt-2",
    }
    getTaskMap(manager).set(task.id, task)

    //#when
    const resolvedTask = manager.findBySession("session-attempt-1")
    manager.handleEvent({
      type: "session.error",
      properties: {
        sessionId: "session-attempt-1",
        error: { name: "UnknownError", message: "late event from old session" },
      },
    })
    await flushBackgroundNotifications()

    //#then
    expect(resolvedTask?.id).toBe(task.id)
    expect(task.currentAttemptID).toBe("attempt-2")
    expect(task.sessionId).toBe("session-attempt-2")
    expect(task.status).toBe("running")
    expect(task.error).toBeUndefined()
    expect(task.attempts?.[0]).toMatchObject({
      attemptId: "attempt-1",
      status: "error",
      error: "first attempt failed",
    })
    expect(task.attempts?.[1]).toMatchObject({
      attemptId: "attempt-2",
      sessionId: "session-attempt-2",
      status: "running",
    })

    manager.shutdown()
  })

  test("late launch prompt errors from a historical attempt do not interrupt the current retry attempt", async () => {
    //#given
    let rejectPrompt: ((error: unknown) => void) | undefined
    const abortCalls: string[] = []
    const client = {
      session: {
        get: async () => ({ data: { directory: "/test/dir" } }),
        create: async () => ({ data: { id: "session-attempt-1" } }),
        promptAsync: async () => new Promise((_, reject) => {
          rejectPrompt = reject
        }),
        abort: async ({ path }: { path: { id: string } }) => {
          abortCalls.push(path.id)
          return {}
        },
      },
    }
    const manager = new BackgroundManager({ pluginContext: { client, directory: tmpdir() } as unknown as PluginInput })
    stubNotifyParentSession(manager)
    ;(cast<{
      tryFallbackRetry: (task: BackgroundTask, errorInfo: { name?: string; message?: string }, source: string) => Promise<boolean>
    }>(manager)).tryFallbackRetry = async () => false
    const task: BackgroundTask = {
      id: "task-stale-prompt-error",
      status: "pending",
      queuedAt: new Date("2026-04-27T00:00:00.000Z"),
      description: "ignore stale prompt errors",
      prompt: "continue",
      agent: "sisyphus-junior",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
      model: { providerID: "openai", modelID: "gpt-5.4-mini" },
      attempts: [
        {
          attemptId: "attempt-1",
          attemptNumber: 1,
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          status: "pending",
        },
      ],
      currentAttemptID: "attempt-1",
    }
    getTaskMap(manager).set(task.id, task)
    const input: import("./types").LaunchInput = {
      description: task.description,
      prompt: task.prompt,
      agent: task.agent,
      parentSessionId: task.parentSessionId,
      parentMessageId: task.parentMessageId,
      model: task.model,
    }

    await (cast<{
      startTask: (item: { task: BackgroundTask; input: import("./types").LaunchInput; attemptID: string }) => Promise<void>
    }>(manager)).startTask({ task, input, attemptID: "attempt-1" })

    task.attempts = [
      {
        attemptId: "attempt-1",
        attemptNumber: 1,
        sessionId: "session-attempt-1",
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        status: "error",
        error: "first attempt failed",
        startedAt: new Date("2026-04-27T00:00:00.000Z"),
        completedAt: new Date("2026-04-27T00:00:05.000Z"),
      },
      {
        attemptId: "attempt-2",
        attemptNumber: 2,
        sessionId: "session-attempt-2",
        providerId: "anthropic",
        modelId: "claude-haiku-4.5",
        status: "running",
        startedAt: new Date("2026-04-27T00:00:10.000Z"),
      },
    ]
    task.currentAttemptID = "attempt-2"
    task.sessionId = "session-attempt-2"
    task.status = "running"
    task.error = undefined

    //#when
    rejectPrompt?.({ name: "APIError", data: { message: "Forbidden: Selected provider is forbidden" } })
    await flushBackgroundNotifications()

    //#then
    expect(task.currentAttemptID).toBe("attempt-2")
    expect(task.sessionId).toBe("session-attempt-2")
    expect(task.status).toBe("running")
    expect(task.error).toBeUndefined()
    expect(task.attempts?.[0]).toMatchObject({
      attemptId: "attempt-1",
      status: "error",
      error: "first attempt failed",
    })
    expect(task.attempts?.[1]).toMatchObject({
      attemptId: "attempt-2",
      status: "running",
      sessionId: "session-attempt-2",
    })
    expect(abortCalls).toEqual([])

    manager.shutdown()
  })
})

import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { afterEach, describe, expect, test } from "bun:test"
import { ConcurrencyManager } from "./concurrency"
import { BackgroundManager } from "./manager"
import type { BackgroundTask, LaunchInput } from "./types"

const managersToShutdown: BackgroundManager[] = []

afterEach(() => {
  while (managersToShutdown.length > 0) managersToShutdown.pop()?.shutdown()
})

function createBackgroundManager(
  config?: { defaultConcurrency?: number },
  abortSession: () => Promise<unknown> = async () => ({ data: true }),
): BackgroundManager {
  const directory = tmpdir()
  const client = { session: {} as PluginInput["client"]["session"] } as PluginInput["client"]

  Reflect.set(client.session, "abort", abortSession)
  Reflect.set(client.session, "create", async () => ({ data: { id: `session-${crypto.randomUUID().slice(0, 8)}` } }))
  Reflect.set(client.session, "get", async () => ({ data: { directory } }))
  Reflect.set(client.session, "messages", async () => ({ data: [] }))
  Reflect.set(client.session, "prompt", async () => ({ data: { info: {}, parts: [] } }))
  Reflect.set(client.session, "promptAsync", async () => ({ data: undefined }))

  const manager = new BackgroundManager({ pluginContext: {
    $: {} as PluginInput["$"],
    client,
    directory,
    project: {} as PluginInput["project"],
    serverUrl: new URL("http://localhost"),
    worktree: directory,
  }, config: config })
  managersToShutdown.push(manager)
  return manager
}

function createMockTask(overrides: Partial<BackgroundTask> & { id: string; parentSessionId: string }): BackgroundTask {
  return {
    id: overrides.id,
    sessionId: overrides.sessionId,
    parentSessionId: overrides.parentSessionId,
    parentMessageId: overrides.parentMessageId ?? "parent-message-id",
    description: overrides.description ?? "test task",
    prompt: overrides.prompt ?? "test prompt",
    agent: overrides.agent ?? "test-agent",
    status: overrides.status ?? "running",
    queuedAt: overrides.queuedAt,
    startedAt: overrides.startedAt ?? new Date(),
    completedAt: overrides.completedAt,
    error: overrides.error,
    model: overrides.model,
    concurrencyKey: overrides.concurrencyKey,
    concurrencyGroup: overrides.concurrencyGroup,
    progress: overrides.progress,
  }
}

function getTaskMap(manager: BackgroundManager): Map<string, BackgroundTask> { return Reflect.get(manager, "tasks") as Map<string, BackgroundTask> }

function getPendingByParent(manager: BackgroundManager): Map<string, Set<string>> { return Reflect.get(manager, "pendingByParent") as Map<string, Set<string>> }

function getQueuesByKey(manager: BackgroundManager): Map<string, Array<{ task: BackgroundTask; input: LaunchInput }>> { return Reflect.get(manager, "queuesByKey") as Map<string, Array<{ task: BackgroundTask; input: LaunchInput }>> }

function getConcurrencyManager(manager: BackgroundManager): ConcurrencyManager { return Reflect.get(manager, "concurrencyManager") as ConcurrencyManager }

function getCompletionTimers(manager: BackgroundManager): Map<string, ReturnType<typeof setTimeout>> { return Reflect.get(manager, "completionTimers") as Map<string, ReturnType<typeof setTimeout>> }

async function processKeyForTest(manager: BackgroundManager, key: string): Promise<void> {
  const processKey = Reflect.get(manager, "processKey") as (key: string) => Promise<void>
  await processKey.call(manager, key)
}

function runScheduledCleanup(manager: BackgroundManager, taskId: string): void {
  const timer = getCompletionTimers(manager).get(taskId)
  if (!timer) {
    throw new Error(`Expected cleanup timer for task ${taskId}`)
  }

  const onTimeout = Reflect.get(timer, "_onTimeout") as (() => void) | undefined
  if (!onTimeout) {
    throw new Error(`Expected cleanup callback for task ${taskId}`)
  }

  onTimeout()
}

describe("BackgroundManager.cancelTask cleanup", () => {
  test("#given a running task in BackgroundManager #when cancelTask called with skipNotification=true #then task is eventually removed from this.tasks Map", async () => {
    // given
    const manager = createBackgroundManager()
    const task = createMockTask({
      id: "task-skip-notification-cleanup",
      parentSessionId: "parent-session-skip-notification-cleanup",
      sessionId: "session-skip-notification-cleanup",
    })

    getTaskMap(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

    // when
    const cancelled = await manager.cancelTask(task.id, {
      skipNotification: true,
      source: "test",
    })

    // then
    expect(cancelled).toBe(true)
    expect(getPendingByParent(manager).get(task.parentSessionId)).toBeUndefined()
    runScheduledCleanup(manager, task.id)
    expect(getTaskMap(manager).has(task.id)).toBe(false)
    expect(manager.getTask(task.id)?.sessionId).toBe(task.sessionId)
  })

  test("#given running task abort returns SDK error #when cancelTask runs #then cancellation fails and task stays running", async () => {
    // given
    const manager = createBackgroundManager(undefined, async () => ({ error: { message: "session still active" } }))
    const task = createMockTask({
      id: "task-abort-error",
      parentSessionId: "parent-session-abort-error",
      sessionId: "session-abort-error",
    })

    getTaskMap(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

    // when
    const cancelled = await manager.cancelTask(task.id, {
      skipNotification: true,
      source: "test",
    })

    // then
    expect(cancelled).toBe(false)
    expect(task.status).toBe("running")
    expect(task.cancellationRequested).toBeUndefined()
    expect(getTaskMap(manager).get(task.id)).toBe(task)
    expect(getPendingByParent(manager).get(task.parentSessionId)).toEqual(new Set([task.id]))
  })

  test("#given a running task #when cancelTask called with skipNotification=false #then task is also eventually removed", async () => {
    // given
    const manager = createBackgroundManager()
    const task = createMockTask({
      id: "task-notify-cleanup",
      parentSessionId: "parent-session-notify-cleanup",
      sessionId: "session-notify-cleanup",
    })

    getTaskMap(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

    // when
    const cancelled = await manager.cancelTask(task.id, {
      skipNotification: false,
      source: "test",
    })

    // then
    expect(cancelled).toBe(true)
    runScheduledCleanup(manager, task.id)
    expect(getTaskMap(manager).has(task.id)).toBe(false)
    expect(manager.getTask(task.id)?.sessionId).toBe(task.sessionId)
  })

  test("#given a running task #when cancelTask called with skipNotification=true #then concurrency slot is freed and pending tasks can start", async () => {
    // given
    const manager = createBackgroundManager({ defaultConcurrency: 1 })
    const concurrencyManager = getConcurrencyManager(manager)
    const concurrencyKey = "test-provider/test-model"
    await concurrencyManager.acquire(concurrencyKey)

    const runningTask = createMockTask({
      id: "task-running-before-cancel",
      parentSessionId: "parent-session-concurrency-cleanup",
      sessionId: "session-running-before-cancel",
      concurrencyKey,
    })
    const pendingTask = createMockTask({
      id: "task-pending-after-cancel",
      parentSessionId: runningTask.parentSessionId,
      status: "pending",
      startedAt: undefined,
      queuedAt: new Date(),
      model: { providerID: "test-provider", modelID: "test-model" },
    })
    const queuedInput: LaunchInput = {
      agent: pendingTask.agent,
      description: pendingTask.description,
      model: pendingTask.model,
      parentMessageId: pendingTask.parentMessageId,
      parentSessionId: pendingTask.parentSessionId,
      prompt: pendingTask.prompt,
    }

    getTaskMap(manager).set(runningTask.id, runningTask)
    getTaskMap(manager).set(pendingTask.id, pendingTask)
    getPendingByParent(manager).set(runningTask.parentSessionId, new Set([runningTask.id, pendingTask.id]))
    getQueuesByKey(manager).set(concurrencyKey, [{ input: queuedInput, task: pendingTask }])

    Reflect.set(manager, "startTask", async ({ task }: { task: BackgroundTask; input: LaunchInput }) => {
      task.status = "running"
      task.startedAt = new Date()
      task.sessionId = "session-started-after-cancel"
      task.concurrencyKey = concurrencyKey
      task.concurrencyGroup = concurrencyKey
    })

    // when
    const cancelled = await manager.cancelTask(runningTask.id, {
      abortSession: false,
      skipNotification: true,
      source: "test",
    })
    await processKeyForTest(manager, concurrencyKey)

    // then
    expect(cancelled).toBe(true)
    expect(concurrencyManager.getCount(concurrencyKey)).toBe(1)
    expect(manager.getTask(pendingTask.id)?.status).toBe("running")
  })

  test("#given cancellation is waiting for session abort #when session.idle arrives #then idle does not complete or re-abort the task", async () => {
    let resolveAbort: (() => void) | undefined
    let abortStarted: (() => void) | undefined
    const abortPending = new Promise<void>((resolve) => { resolveAbort = resolve })
    const abortStartedPromise = new Promise<void>((resolve) => { abortStarted = resolve })
    let abortCalls = 0
    const manager = createBackgroundManager(undefined, async () => {
      abortCalls += 1
      abortStarted?.()
      await abortPending
      return { data: true }
    })
    const task = createMockTask({
      id: "task-cancel-idle-race",
      parentSessionId: "parent-session-cancel-idle-race",
      sessionId: "session-cancel-idle-race",
    })

    getTaskMap(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))
    Reflect.set(manager, "validateSessionHasOutput", async () => true)
    Reflect.set(manager, "checkSessionTodos", async () => false)
    let fallbackCalls = 0
    Reflect.set(manager, "tryFallbackRetry", async () => {
      fallbackCalls += 1
      return true
    })

    const cancellation = manager.cancelTask(task.id, {
      skipNotification: true,
      source: "test",
    })
    await abortStartedPromise
    manager.handleEvent({
      type: "session.idle",
      properties: { sessionID: task.sessionId },
    })
    manager.handleEvent({
      type: "message.updated",
      properties: {
        info: {
          sessionID: task.sessionId,
          role: "assistant",
          error: { name: "MessageAbortedError", message: "Aborted" },
        },
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(task.status).toBe("running")
    expect(task.cancellationRequested).toBe(true)
    expect(abortCalls).toBe(1)
    expect(fallbackCalls).toBe(0)

    resolveAbort?.()
    expect(await cancellation).toBe(true)
    expect(task.status).toBe("cancelled")
    expect(abortCalls).toBe(1)
  })

  test("#given cancellation is already in flight #when cancelTask is called again #then only the first request aborts and finalizes", async () => {
    let resolveAbort: (() => void) | undefined
    let abortStarted: (() => void) | undefined
    const abortPending = new Promise<void>((resolve) => { resolveAbort = resolve })
    const abortStartedPromise = new Promise<void>((resolve) => { abortStarted = resolve })
    let abortCalls = 0
    const manager = createBackgroundManager(undefined, async () => {
      abortCalls += 1
      abortStarted?.()
      await abortPending
      return { data: true }
    })
    const task = createMockTask({
      id: "task-concurrent-cancel",
      parentSessionId: "parent-session-concurrent-cancel",
      sessionId: "session-concurrent-cancel",
    })

    getTaskMap(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

    const firstCancellation = manager.cancelTask(task.id, { skipNotification: true, source: "first" })
    await abortStartedPromise
    const secondCancellation = manager.cancelTask(task.id, { skipNotification: true, source: "second" })

    expect(await secondCancellation).toBe(false)
    expect(abortCalls).toBe(1)

    resolveAbort?.()
    expect(await firstCancellation).toBe(true)
    expect(task.status).toBe("cancelled")
  })

  test("#given cancellation abort fails while idle is suppressed #when abort failure completes #then the idle event is replayed", async () => {
    let rejectAbort: (() => void) | undefined
    let abortStarted: (() => void) | undefined
    const abortPending = new Promise<void>((_, reject) => { rejectAbort = () => reject(new Error("abort failed")) })
    const abortStartedPromise = new Promise<void>((resolve) => { abortStarted = resolve })
    let abortCalls = 0
    const manager = createBackgroundManager(undefined, async () => {
      abortCalls += 1
      if (abortCalls === 1) {
        abortStarted?.()
        await abortPending
      }
      return { data: true }
    })
    const task = createMockTask({
      id: "task-replay-idle-after-abort-failure",
      parentSessionId: "parent-session-replay-idle",
      sessionId: "session-replay-idle",
      startedAt: new Date(Date.now() - 10_000),
    })

    getTaskMap(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))
    Reflect.set(manager, "validateSessionHasOutput", async () => true)
    Reflect.set(manager, "checkSessionTodos", async () => false)

    const cancellation = manager.cancelTask(task.id, { skipNotification: true, source: "test" })
    await abortStartedPromise
    manager.handleEvent({ type: "session.idle", properties: { sessionID: task.sessionId } })
    rejectAbort?.()

    expect(await cancellation).toBe(false)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(task.status).toBe("completed")
    expect(abortCalls).toBe(2)
  })

  test("#given cancellation abort fails while assistant error is suppressed #when abort failure completes #then the assistant error is replayed", async () => {
    let rejectAbort: (() => void) | undefined
    let abortStarted: (() => void) | undefined
    const abortPending = new Promise<void>((_, reject) => { rejectAbort = () => reject(new Error("abort failed")) })
    const abortStartedPromise = new Promise<void>((resolve) => { abortStarted = resolve })
    let fallbackCalls = 0
    const manager = createBackgroundManager(undefined, async () => {
      abortStarted?.()
      await abortPending
      return { data: true }
    })
    const task = createMockTask({
      id: "task-replay-assistant-error-after-abort-failure",
      parentSessionId: "parent-session-replay-assistant-error",
      sessionId: "session-replay-assistant-error",
    })

    getTaskMap(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))
    Reflect.set(manager, "tryFallbackRetry", async () => {
      fallbackCalls += 1
      return true
    })

    const cancellation = manager.cancelTask(task.id, { skipNotification: true, source: "test" })
    await abortStartedPromise
    manager.handleEvent({
      type: "message.updated",
      properties: {
        info: { sessionID: task.sessionId, role: "assistant", error: { name: "Retryable", message: "temporary" } },
      },
    })
    rejectAbort?.()

    expect(await cancellation).toBe(false)
    await Promise.resolve()
    await Promise.resolve()
    expect(fallbackCalls).toBe(1)
  })

  test("#given cancellation abort fails while session error is suppressed #when abort failure completes #then the session error is replayed", async () => {
    let rejectAbort: (() => void) | undefined
    let abortStarted: (() => void) | undefined
    const abortPending = new Promise<void>((_, reject) => { rejectAbort = () => reject(new Error("abort failed")) })
    const abortStartedPromise = new Promise<void>((resolve) => { abortStarted = resolve })
    const manager = createBackgroundManager(undefined, async () => {
      abortStarted?.()
      await abortPending
      return { data: true }
    })
    const task = createMockTask({
      id: "task-replay-session-error-after-abort-failure",
      parentSessionId: "parent-session-replay-session-error",
      sessionId: "session-replay-session-error",
    })

    getTaskMap(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))
    Reflect.set(manager, "verifySessionExists", async () => false)

    const cancellation = manager.cancelTask(task.id, { skipNotification: true, source: "test" })
    await abortStartedPromise
    manager.handleEvent({
      type: "session.error",
      properties: { sessionID: task.sessionId, error: { name: "MessageAbortedError", message: "Aborted" } },
    })
    rejectAbort?.()

    expect(await cancellation).toBe(false)
    await Promise.resolve()
    await Promise.resolve()
    expect(task.status).toBe("error")
    expect(task.error).toBe("Aborted")
  })
})

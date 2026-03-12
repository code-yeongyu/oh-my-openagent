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

function createBackgroundManager(config?: { defaultConcurrency?: number }): BackgroundManager {
  const directory = tmpdir()
  const client = { session: {} as PluginInput["client"]["session"] } as PluginInput["client"]

  Reflect.set(client.session, "abort", async () => ({ data: true }))
  Reflect.set(client.session, "create", async () => ({ data: { id: `session-${crypto.randomUUID().slice(0, 8)}` } }))
  Reflect.set(client.session, "get", async () => ({ data: { directory } }))
  Reflect.set(client.session, "messages", async () => ({ data: [] }))
  Reflect.set(client.session, "prompt", async () => ({ data: { info: {}, parts: [] } }))
  Reflect.set(client.session, "promptAsync", async () => ({ data: undefined }))

  const manager = new BackgroundManager({
    $: {} as PluginInput["$"],
    client,
    directory,
    project: {} as PluginInput["project"],
    serverUrl: new URL("http://localhost"),
    worktree: directory,
  }, config)
  managersToShutdown.push(manager)
  return manager
}

function createMockTask(overrides: Partial<BackgroundTask> & { id: string; parentSessionID: string }): BackgroundTask {
  return {
    id: overrides.id,
    sessionID: overrides.sessionID,
    parentSessionID: overrides.parentSessionID,
    parentMessageID: overrides.parentMessageID ?? "parent-message-id",
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
      parentSessionID: "parent-session-skip-notification-cleanup",
      sessionID: "session-skip-notification-cleanup",
    })

    getTaskMap(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionID, new Set([task.id]))

    // when
    const cancelled = await manager.cancelTask(task.id, {
      skipNotification: true,
      source: "test",
    })

    // then
    expect(cancelled).toBe(true)
    expect(getPendingByParent(manager).get(task.parentSessionID)).toBeUndefined()
    runScheduledCleanup(manager, task.id)
    expect(manager.getTask(task.id)).toBeUndefined()
  })

  test("#given a running task #when cancelTask called with skipNotification=false #then task is also eventually removed", async () => {
    // given
    const manager = createBackgroundManager()
    const task = createMockTask({
      id: "task-notify-cleanup",
      parentSessionID: "parent-session-notify-cleanup",
      sessionID: "session-notify-cleanup",
    })

    getTaskMap(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionID, new Set([task.id]))

    // when
    const cancelled = await manager.cancelTask(task.id, {
      skipNotification: false,
      source: "test",
    })

    // then
    expect(cancelled).toBe(true)
    runScheduledCleanup(manager, task.id)
    expect(manager.getTask(task.id)).toBeUndefined()
  })

  test("#given a running task #when cancelTask called with skipNotification=true #then concurrency slot is freed and pending tasks can start", async () => {
    // given
    const manager = createBackgroundManager({ defaultConcurrency: 1 })
    const concurrencyManager = getConcurrencyManager(manager)
    const concurrencyKey = "test-provider/test-model"
    await concurrencyManager.acquire(concurrencyKey)

    const runningTask = createMockTask({
      id: "task-running-before-cancel",
      parentSessionID: "parent-session-concurrency-cleanup",
      sessionID: "session-running-before-cancel",
      concurrencyKey,
    })
    const pendingTask = createMockTask({
      id: "task-pending-after-cancel",
      parentSessionID: runningTask.parentSessionID,
      status: "pending",
      startedAt: undefined,
      queuedAt: new Date(),
      model: { providerID: "test-provider", modelID: "test-model" },
    })
    const queuedInput: LaunchInput = {
      agent: pendingTask.agent,
      description: pendingTask.description,
      model: pendingTask.model,
      parentMessageID: pendingTask.parentMessageID,
      parentSessionID: pendingTask.parentSessionID,
      prompt: pendingTask.prompt,
    }

    getTaskMap(manager).set(runningTask.id, runningTask)
    getTaskMap(manager).set(pendingTask.id, pendingTask)
    getPendingByParent(manager).set(runningTask.parentSessionID, new Set([runningTask.id, pendingTask.id]))
    getQueuesByKey(manager).set(concurrencyKey, [{ input: queuedInput, task: pendingTask }])

    Reflect.set(manager, "startTask", async ({ task }: { task: BackgroundTask; input: LaunchInput }) => {
      task.status = "running"
      task.startedAt = new Date()
      task.sessionID = "session-started-after-cancel"
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
})

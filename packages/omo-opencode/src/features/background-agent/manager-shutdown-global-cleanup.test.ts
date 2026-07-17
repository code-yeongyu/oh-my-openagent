import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { tmpdir } from "node:os"

import { _resetForTesting, subagentSessions } from "../claude-code-session-state"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

function createDeferredPromise(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolvePromise = () => {}
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: resolvePromise,
  }
}

function createTask(overrides: Partial<BackgroundTask> & { id: string; sessionId: string }): BackgroundTask {
  return {
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    description: "test task",
    prompt: "test prompt",
    agent: "explore",
    status: "running",
    startedAt: new Date(),
    ...overrides,
  }
}

function createBackgroundManager(): BackgroundManager {
  return new BackgroundManager({ pluginContext: {
    client: {
      session: {
        abort: async () => ({}),
        prompt: async () => ({}),
        promptAsync: async () => ({}),
      },
    } as never,
    project: {} as never,
    directory: tmpdir(),
    worktree: tmpdir(),
    serverUrl: new URL("https://example.com"),
    $: {} as never,
  } as never })
}

type ManagerInternals = {
  tasks: Map<string, BackgroundTask>
  queuesByKey: Map<string, Array<{ task: BackgroundTask; input: never; rawConcurrencyKey: string }>>
  pendingByParent: Map<string, Set<string>>
  notifications: Map<string, BackgroundTask[]>
  taskHistory: { getByParentSession: (parentSessionID: string) => unknown[] }
  pollingInterval?: ReturnType<typeof setInterval>
  concurrencyManager: { acquire: (key: string, taskID: string) => Promise<void> }
  processKey: (key: string) => Promise<void>
}

function getInternals(manager: BackgroundManager): ManagerInternals {
  return manager as unknown as ManagerInternals
}

describe("BackgroundManager shutdown global cleanup", () => {
  beforeEach(() => {
    // given
    _resetForTesting()
    SessionCategoryRegistry.clear()
  })

  afterEach(() => {
    // given
    _resetForTesting()
    SessionCategoryRegistry.clear()
  })

  test("removes tracked session IDs from subagentSessions and SessionCategoryRegistry on shutdown", async () => {
    // given
    const runningSessionID = "ses-running-shutdown-cleanup"
    const completedSessionID = "ses-completed-shutdown-cleanup"
    const unrelatedSessionID = "ses-unrelated-shutdown-cleanup"
    const manager = createBackgroundManager()
    const tasks = new Map<string, BackgroundTask>([
      [
        "task-running-shutdown-cleanup",
        createTask({
          id: "task-running-shutdown-cleanup",
          sessionId: runningSessionID,
        }),
      ],
      [
        "task-completed-shutdown-cleanup",
        createTask({
          id: "task-completed-shutdown-cleanup",
          sessionId: completedSessionID,
          status: "completed",
          completedAt: new Date(),
        }),
      ],
    ])

    Object.assign(manager, { tasks })

    subagentSessions.add(runningSessionID)
    subagentSessions.add(completedSessionID)
    subagentSessions.add(unrelatedSessionID)
    SessionCategoryRegistry.register(runningSessionID, "quick")
    SessionCategoryRegistry.register(completedSessionID, "deep")
    SessionCategoryRegistry.register(unrelatedSessionID, "test")

    // when
    await manager.shutdown()

    // then
    expect(subagentSessions.has(runningSessionID)).toBe(false)
    expect(subagentSessions.has(completedSessionID)).toBe(false)
    expect(subagentSessions.has(unrelatedSessionID)).toBe(true)
    expect(SessionCategoryRegistry.has(runningSessionID)).toBe(false)
    expect(SessionCategoryRegistry.has(completedSessionID)).toBe(false)
    expect(SessionCategoryRegistry.has(unrelatedSessionID)).toBe(true)
  })

  test("awaits running session aborts before shutdown resolves", async () => {
    // given
    const runningSessionID = "ses-running-await-shutdown"
    const deferred = createDeferredPromise()
    const manager = createBackgroundManager()
    const tasks = new Map<string, BackgroundTask>([
      [
        "task-running-await-shutdown",
        createTask({
          id: "task-running-await-shutdown",
          sessionId: runningSessionID,
        }),
      ],
    ])

    Object.assign(manager, { tasks })
    Object.assign(manager, {
      client: {
        session: {
          abort: () => deferred.promise,
          prompt: async () => ({}),
          promptAsync: async () => ({}),
        },
      },
    })

    // when
    const shutdownPromise = manager.shutdown()
    let settled = false
    void shutdownPromise.then(() => {
      settled = true
    })

    await Promise.resolve()

    // then
    expect(settled).toBe(false)

    deferred.resolve()
    await shutdownPromise

    expect(settled).toBe(true)
  })

  test("rejects externally tracked tasks after shutdown", async () => {
    // given
    const manager = createBackgroundManager()
    await manager.shutdown()

    // when / then
    await expect(manager.trackTask({
      taskId: "task-after-shutdown",
      sessionId: "session-after-shutdown",
      parentSessionId: "parent-after-shutdown",
      description: "must not be tracked",
      agent: "explore",
    })).rejects.toThrow("Background manager is shutting down")

    const internals = getInternals(manager)
    expect(internals.tasks.size).toBe(0)
    expect(internals.pendingByParent.size).toBe(0)
    expect(internals.pollingInterval).toBeUndefined()
    expect(manager.hasBackgroundWorkInFlight("parent-after-shutdown")).toBe(false)
  })

  test("does not process a queue after shutdown", async () => {
    // given
    const manager = createBackgroundManager()
    await manager.shutdown()
    const internals = getInternals(manager)
    const acquire = mock(async () => {})
    internals.concurrencyManager.acquire = acquire
    const task = createTask({
      id: "task-queued-after-shutdown",
      sessionId: "",
      status: "pending",
    })
    internals.queuesByKey.set("explore", [{
      task,
      input: {} as never,
      rawConcurrencyKey: "explore",
    }])

    // when
    await internals.processKey("explore")

    // then
    expect(acquire).not.toHaveBeenCalled()
  })

  test("does not recreate cancellation state when an abort resumes after shutdown", async () => {
    // given
    const firstAbort = createDeferredPromise()
    let abortCalls = 0
    const manager = createBackgroundManager()
    const internals = getInternals(manager)
    const task = createTask({
      id: "task-cancel-resumes-after-shutdown",
      sessionId: "session-cancel-resumes-after-shutdown",
    })
    internals.tasks.set(task.id, task)
    Object.assign(manager, {
      client: {
        session: {
          abort: () => {
            abortCalls += 1
            return abortCalls === 1 ? firstAbort.promise : Promise.resolve({})
          },
          prompt: async () => ({}),
          promptAsync: async () => ({}),
        },
      },
    })

    // when
    const cancellation = manager.cancelTask(task.id, { source: "test" })
    while (abortCalls === 0) await Promise.resolve()
    await manager.shutdown()
    firstAbort.resolve()
    const cancelled = await cancellation

    // then
    expect(cancelled).toBe(false)
    expect(abortCalls).toBe(2)
    expect(internals.tasks.size).toBe(0)
    expect(internals.notifications.size).toBe(0)
    expect(internals.pendingByParent.size).toBe(0)
    expect(internals.taskHistory.getByParentSession(task.parentSessionId)).toHaveLength(0)
    expect(internals.pollingInterval).toBeUndefined()
    expect(manager.hasBackgroundWorkInFlight(task.parentSessionId)).toBe(false)
  })
})

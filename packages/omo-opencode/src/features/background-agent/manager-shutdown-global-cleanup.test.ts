import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { _resetForTesting, subagentSessions } from "../claude-code-session-state"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { readContinuationMarker, setContinuationMarkerSource } from "../run-continuation-state/storage"
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

function createBackgroundManager(config?: { defaultConcurrency?: number }): BackgroundManager {
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
  } as never, config })
}

type ManagerInternals = {
  tasks: Map<string, BackgroundTask>
  queuesByKey: Map<string, Array<{ task: BackgroundTask; input: never; rawConcurrencyKey: string }>>
  pendingByParent: Map<string, Set<string>>
  notifications: Map<string, BackgroundTask[]>
  notificationQueueByParent: Map<string, Promise<void>>
  completedTaskSummaries: Map<string, unknown[]>
  releasedRootDescendantTasks: Set<string>
  rootDescendantCounts: Map<string, number>
  taskHistory: { getByParentSession: (parentSessionID: string) => unknown[] }
  pollingInterval?: ReturnType<typeof setInterval>
  concurrencyManager: {
    acquire: (key: string, taskID?: string) => Promise<void>
    release: (key: string) => void
    getQueueLength: (key: string) => number
  }
  processKey: (key: string) => Promise<void>
  pollRunningTasks: () => Promise<void>
  shutdownTimeoutMs: number
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

  test("does not register a tracked task whose concurrency wait resumes after shutdown", async () => {
    // given
    const manager = createBackgroundManager({ defaultConcurrency: 1 })
    const internals = getInternals(manager)
    await internals.concurrencyManager.acquire("shared", "slot-holder")
    const tracking = manager.trackTask({
      taskId: "task-waiting-during-shutdown",
      sessionId: "session-waiting-during-shutdown",
      parentSessionId: "parent-waiting-during-shutdown",
      description: "must not resume after shutdown",
      agent: "explore",
      concurrencyKey: "shared",
    })
    expect(internals.concurrencyManager.getQueueLength("shared")).toBe(1)

    // when
    internals.concurrencyManager.release("shared")
    await manager.shutdown()

    // then
    await expect(tracking).rejects.toThrow("Background manager is shutting down")
    expect(internals.tasks.size).toBe(0)
    expect(internals.notifications.size).toBe(0)
    expect(internals.pendingByParent.size).toBe(0)
    expect(internals.taskHistory.getByParentSession("parent-waiting-during-shutdown")).toHaveLength(0)
    expect(internals.pollingInterval).toBeUndefined()
    expect(manager.hasBackgroundWorkInFlight("parent-waiting-during-shutdown")).toBe(false)
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
    const shutdown = manager.shutdown()
    let shutdownSettled = false
    void shutdown.then(() => { shutdownSettled = true })
    await Promise.resolve()

    expect(shutdownSettled).toBe(false)

    firstAbort.resolve()
    const [cancelled] = await Promise.all([cancellation, shutdown])

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

  test("does not mutate cleared ownership or successor continuation state when stale interruption resumes after shutdown", async () => {
    // given
    const directory = await mkdtemp(join(tmpdir(), "pr6005-stale-shutdown-"))
    const firstAbort = createDeferredPromise()
    const firstAbortStarted = createDeferredPromise()
    let abortCalls = 0
    const manager = new BackgroundManager({
      pluginContext: {
        client: {
          session: {
            status: async () => ({ data: { "stale-session": { type: "idle" } } }),
            abort: async () => {
              abortCalls += 1
              if (abortCalls === 1) {
                firstAbortStarted.resolve()
                await firstAbort.promise
              }
              return {}
            },
            promptAsync: async () => ({}),
          },
        } as never,
        directory,
      } as never,
      config: { messageStalenessTimeoutMs: 1 },
    })
    const internals = getInternals(manager)
    const task = createTask({
      id: "stale-task-after-shutdown",
      sessionId: "stale-session",
      rootSessionId: "parent-session",
      parentSessionId: "parent-session",
      startedAt: new Date(Date.now() - 60_000),
      concurrencyKey: "explore",
      concurrencyGroup: "explore",
    })
    internals.tasks.set(task.id, task)
    internals.rootDescendantCounts.set(task.parentSessionId, 1)
    internals.shutdownTimeoutMs = 15

    try {
      const poll = internals.pollRunningTasks()
      await firstAbortStarted.promise
      await manager.shutdown()
      setContinuationMarkerSource(
        directory,
        task.parentSessionId,
        "background-task",
        "active",
        "replacement manager active",
      )

      // when
      firstAbort.resolve()
      await poll

      // then
      expect(internals.tasks.size).toBe(0)
      expect(internals.releasedRootDescendantTasks.size).toBe(0)
      expect(task.status).toBe("running")
      expect(readContinuationMarker(directory, task.parentSessionId)?.sources["background-task"]).toMatchObject({
        state: "active",
        reason: "replacement manager active",
      })
    } finally {
      firstAbort.resolve()
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("waits for an admitted launch prompt before shutdown completes", async () => {
    // given
    const prompt = createDeferredPromise()
    let promptStarted = false
    const manager = new BackgroundManager({ pluginContext: {
      client: {
        session: {
          get: async () => ({ data: { directory: tmpdir() } }),
          create: async () => ({ data: { id: "session-launch-owned-by-shutdown" } }),
          promptAsync: async () => {
            promptStarted = true
            await prompt.promise
            return {}
          },
          abort: async () => ({}),
        },
      } as never,
      directory: tmpdir(),
    } as never })
    const task = createTask({
      id: "task-launch-owned-by-shutdown",
      sessionId: "",
      status: "pending",
      startedAt: undefined,
      queuedAt: new Date(),
    })
    const input = {
      description: "owned launch prompt",
      prompt: "work",
      agent: "general",
      parentSessionId: "parent-launch-owned-by-shutdown",
      parentMessageId: "message-launch-owned-by-shutdown",
    }
    await (manager as unknown as {
      startTask: (item: { task: BackgroundTask; input: typeof input }) => Promise<void>
    }).startTask({ task, input })
    while (!promptStarted) await Promise.resolve()

    // when
    const shutdown = manager.shutdown()
    const outcome = await Promise.race([
      shutdown.then(() => "resolved" as const),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 50)),
    ])

    // then
    expect(outcome).toBe("pending")
    prompt.resolve()
    await shutdown
  })

  test("waits for an admitted resume dispatch before shutdown completes", async () => {
    // given
    const messages = createDeferredPromise()
    let promptCalls = 0
    const manager = new BackgroundManager({ pluginContext: {
      client: {
        session: {
          messages: async () => {
            await messages.promise
            return { data: [] }
          },
          promptAsync: async () => {
            promptCalls += 1
            return {}
          },
          abort: async () => ({}),
        },
      } as never,
      directory: tmpdir(),
    } as never })
    const task = createTask({
      id: "task-resume-owned-by-shutdown",
      sessionId: "session-resume-owned-by-shutdown",
      status: "completed",
      completedAt: new Date(),
    })
    getInternals(manager).tasks.set(task.id, task)
    await manager.resume({
      sessionId: task.sessionId!,
      prompt: "continue",
      parentSessionId: task.parentSessionId,
      parentMessageId: task.parentMessageId,
    })
    for (let index = 0; index < 12; index += 1) await Promise.resolve()

    // when
    const shutdown = manager.shutdown()
    const outcome = await Promise.race([
      shutdown.then(() => "resolved" as const),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 50)),
    ])

    // then
    expect(outcome).toBe("pending")
    expect(promptCalls).toBe(0)
    messages.resolve()
    await shutdown
    expect(promptCalls).toBe(0)
  })

  test("waits for an admitted tmux session-created callback before shutdown completes", async () => {
    // given
    const callback = createDeferredPromise()
    const events: string[] = []
    let callbackStarted = false
    const originalTmux = process.env.TMUX
    process.env.TMUX = "/tmp/pr6005-owned-tmux"
    const manager = new BackgroundManager({
      pluginContext: {
        client: {
          session: {
            get: async () => ({ data: { directory: tmpdir() } }),
            create: async () => ({ data: { id: "session-tmux-owned-by-shutdown" } }),
            promptAsync: async () => ({}),
            abort: async () => ({}),
          },
        } as never,
        directory: tmpdir(),
      } as never,
      tmuxConfig: { enabled: true } as never,
      onSubagentSessionCreated: async () => {
        events.push("session-created:start")
        callbackStarted = true
        await callback.promise
        events.push("session-created:end")
      },
      onShutdown: () => { events.push("shutdown-cleanup") },
    })

    try {
      const task = createTask({
        id: "task-tmux-owned-by-shutdown",
        sessionId: "",
        status: "pending",
        startedAt: undefined,
        queuedAt: new Date(),
      })
      const input = {
        description: "owned tmux callback",
        prompt: "work",
        agent: "general",
        parentSessionId: "parent-tmux-owned-by-shutdown",
        parentMessageId: "message-tmux-owned-by-shutdown",
      }
      await (manager as unknown as {
        startTask: (item: { task: BackgroundTask; input: typeof input }) => Promise<void>
      }).startTask({ task, input })
      while (!callbackStarted) await Promise.resolve()

      // when
      const shutdown = manager.shutdown()
      const outcome = await Promise.race([
        shutdown.then(() => "resolved" as const),
        new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 50)),
      ])

      // then
      expect(outcome).toBe("pending")
      callback.resolve()
      await shutdown
      expect(events).toEqual([
        "session-created:start",
        "session-created:end",
        "shutdown-cleanup",
      ])
    } finally {
      callback.resolve()
      await manager.shutdown()
      if (originalTmux === undefined) delete process.env.TMUX
      else process.env.TMUX = originalTmux
    }
  })

  test("bounds the complete shutdown drain with one shared deadline", async () => {
    // given
    const stalledShutdown = createDeferredPromise()
    const manager = new BackgroundManager({
      pluginContext: {
        client: {
          session: {
            abort: async () => ({}),
            promptAsync: async () => ({}),
          },
        } as never,
        directory: tmpdir(),
      } as never,
      onShutdown: () => stalledShutdown.promise,
    })
    getInternals(manager).shutdownTimeoutMs = 25

    // when
    const shutdown = manager.shutdown()
    const outcome = await Promise.race([
      shutdown.then(() => "resolved" as const),
      new Promise<"timed-out">((resolve) => {
        setTimeout(() => resolve("timed-out"), 250)
      }),
    ])

    // then
    stalledShutdown.resolve()
    await shutdown
    expect(outcome).toBe("resolved")
    expect(getInternals(manager).tasks.size).toBe(0)
  })

  test("does not dispatch launch fallback after shutdown deadline", async () => {
    // given
    let rejectPrompt = (_error: Error): void => {}
    let promptCalls = 0
    const firstPrompt = new Promise<never>((_resolve, reject) => {
      rejectPrompt = reject
    })
    const manager = new BackgroundManager({ pluginContext: {
      client: {
        session: {
          get: async () => ({ data: { directory: tmpdir() } }),
          create: async () => ({ data: { id: "session-late-fallback-launch" } }),
          promptAsync: async () => {
            promptCalls += 1
            if (promptCalls === 1) return firstPrompt
            return {}
          },
          abort: async () => ({}),
        },
      } as never,
      directory: tmpdir(),
    } as never })
    getInternals(manager).shutdownTimeoutMs = 15
    const task = createTask({
      id: "task-late-fallback-launch",
      sessionId: "",
      status: "pending",
      startedAt: undefined,
      queuedAt: new Date(),
    })
    await (manager as unknown as {
      startTask: (item: { task: BackgroundTask; input: {
        description: string
        prompt: string
        agent: string
        parentSessionId: string
        parentMessageId: string
      } }) => Promise<void>
    }).startTask({
      task,
      input: {
        description: "late fallback launch",
        prompt: "work",
        agent: "explore",
        parentSessionId: "parent-late-fallback-launch",
        parentMessageId: "message-late-fallback-launch",
      },
    })
    while (promptCalls === 0) await Promise.resolve()
    await manager.shutdown()

    // when
    rejectPrompt(new Error("Agent not found: explore"))
    for (let index = 0; index < 12; index += 1) await Promise.resolve()

    // then
    expect(promptCalls).toBe(1)
  })

  test("aborts a delayed tmux callback before its post-await side effect", async () => {
    // given
    const callback = createDeferredPromise()
    let callbackStarted = false
    let callbackSignal: AbortSignal | undefined
    let sideEffects = 0
    const originalTmux = process.env.TMUX
    process.env.TMUX = "/tmp/pr6005-late-tmux"
    const manager = new BackgroundManager({
      pluginContext: {
        client: {
          session: {
            get: async () => ({ data: { directory: tmpdir() } }),
            create: async () => ({ data: { id: "session-late-tmux" } }),
            promptAsync: async () => ({}),
            abort: async () => ({}),
          },
        } as never,
        directory: tmpdir(),
      } as never,
      tmuxConfig: { enabled: true } as never,
      onSubagentSessionCreated: async (event) => {
        callbackStarted = true
        callbackSignal = (event as typeof event & { signal?: AbortSignal }).signal
        await callback.promise
        if (!callbackSignal?.aborted) sideEffects += 1
      },
    })
    getInternals(manager).shutdownTimeoutMs = 15

    try {
      const task = createTask({
        id: "task-late-tmux",
        sessionId: "",
        status: "pending",
        startedAt: undefined,
        queuedAt: new Date(),
      })
      await (manager as unknown as {
        startTask: (item: { task: BackgroundTask; input: {
          description: string
          prompt: string
          agent: string
          parentSessionId: string
          parentMessageId: string
        } }) => Promise<void>
      }).startTask({
        task,
        input: {
          description: "late tmux callback",
          prompt: "work",
          agent: "general",
          parentSessionId: "parent-late-tmux",
          parentMessageId: "message-late-tmux",
        },
      })
      while (!callbackStarted) await Promise.resolve()
      await manager.shutdown()

      // when
      callback.resolve()
      for (let index = 0; index < 12; index += 1) await Promise.resolve()

      // then
      expect(callbackSignal?.aborted).toBe(true)
      expect(sideEffects).toBe(0)
    } finally {
      callback.resolve()
      if (originalTmux === undefined) delete process.env.TMUX
      else process.env.TMUX = originalTmux
    }
  })

  test("does not start shutdown cleanup after the shared deadline is exhausted", async () => {
    // given
    let cleanupCalls = 0
    const manager = new BackgroundManager({
      pluginContext: {
        client: {
          session: {
            promptAsync: async () => ({}),
            abort: async () => ({}),
          },
        } as never,
        directory: tmpdir(),
      } as never,
      onShutdown: () => { cleanupCalls += 1 },
    })
    getInternals(manager).shutdownTimeoutMs = 0

    // when
    await manager.shutdown()

    // then
    expect(cleanupCalls).toBe(0)
  })

  test("does not recreate notification state when session.error finishes after shutdown deadline", async () => {
    // given
    const delayedAbort = createDeferredPromise()
    const delayedMessages = createDeferredPromise()
    let abortCalls = 0
    let messagesCalls = 0
    const manager = createBackgroundManager()
    const internals = getInternals(manager)
    const task = createTask({
      id: "task-session-error-after-shutdown-deadline",
      sessionId: "session-error-after-shutdown-deadline",
      parentSessionId: "parent-session-error-after-shutdown-deadline",
    })
    internals.tasks.set(task.id, task)
    internals.shutdownTimeoutMs = 15
    Object.assign(manager, {
      client: {
        session: {
          abort: () => {
            abortCalls += 1
            return abortCalls === 1 ? delayedAbort.promise : Promise.resolve({})
          },
          messages: async () => {
            messagesCalls += 1
            await delayedMessages.promise
            return { data: [] }
          },
          prompt: async () => ({}),
          promptAsync: async () => ({}),
        },
      },
    })

    manager.handleEvent({
      type: "session.error",
      properties: {
        sessionID: task.sessionId,
        error: {
          name: "AgentNotFoundError",
          message: `Agent not found: ${task.agent}`,
        },
      },
    })
    while (abortCalls === 0) await Promise.resolve()

    // when
    await manager.shutdown()
    delayedAbort.resolve()
    for (let index = 0; index < 20; index += 1) await Promise.resolve()

    const observedAfterLateContinuation = {
      messagesCalls,
      notifications: internals.notifications.size,
      notificationQueues: internals.notificationQueueByParent.size,
      completedTaskSummaries: internals.completedTaskSummaries.size,
      hasBackgroundWork: manager.hasBackgroundWorkInFlight(task.parentSessionId),
    }
    delayedMessages.resolve()

    // then
    expect(observedAfterLateContinuation).toEqual({
      messagesCalls: 0,
      notifications: 0,
      notificationQueues: 0,
      completedTaskSummaries: 0,
      hasBackgroundWork: false,
    })
  })
})

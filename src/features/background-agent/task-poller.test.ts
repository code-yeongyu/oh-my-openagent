import { describe, it, expect, mock } from "bun:test"

import { checkAndInterruptStaleTasks, pruneStaleTasksAndNotifications } from "./task-poller"
import type { BackgroundTask } from "./types"

describe("checkAndInterruptStaleTasks", () => {
  const mockClient = {
    session: {
      abort: mock(() => Promise.resolve()),
    },
  }
  const mockConcurrencyManager = {
    release: mock(() => {}),
  }
  const mockNotify = mock(() => Promise.resolve())

  function createRunningTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
    return {
      id: "task-1",
      sessionID: "ses-1",
      parentSessionID: "parent-ses-1",
      parentMessageID: "msg-1",
      description: "test",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(Date.now() - 120_000),
      ...overrides,
    }
  }

  it("should interrupt tasks with lastUpdate exceeding stale timeout", async () => {
    //#given
    const task = createRunningTask({
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 200_000),
      },
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  it("should NOT interrupt tasks with recent lastUpdate", async () => {
    //#given
    const task = createRunningTask({
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 10_000),
      },
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
    })

    //#then
    expect(task.status).toBe("running")
  })

  it("should interrupt tasks with NO progress.lastUpdate that exceeded messageStalenessTimeoutMs since startedAt", async () => {
    //#given — task started 15 minutes ago, never received any progress update
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("no activity")
  })

  it("should NOT interrupt tasks with NO progress.lastUpdate that are within messageStalenessTimeoutMs", async () => {
    //#given — task started 5 minutes ago, default timeout is 10 minutes
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 5 * 60 * 1000),
      progress: undefined,
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
    })

    //#then
    expect(task.status).toBe("running")
  })

  it("should use DEFAULT_MESSAGE_STALENESS_TIMEOUT_MS when messageStalenessTimeoutMs is not configured", async () => {
    //#given — task started 15 minutes ago, no config for messageStalenessTimeoutMs
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
    })

    //#when — default is 10 minutes (600_000ms)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: undefined,
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("no activity")
  })

  it("should NOT interrupt task when session is running, even if lastUpdate exceeds stale timeout", async () => {
    //#given — lastUpdate is 5min old but session is actively running
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    })

    //#when — session status is "busy" (OpenCode's actual status for active LLM processing)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
    })

    //#then — task should survive because session is actively busy
    expect(task.status).toBe("running")
  })

  it("should NOT interrupt busy session task even with very old lastUpdate", async () => {
    //#given — lastUpdate is 15min old, but session is still busy
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 900_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 900_000),
      },
    })

    //#when — session busy, lastUpdate far exceeds any timeout
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
    })

    //#then — busy sessions are NEVER stale-killed (babysitter + TTL prune handle these)
    expect(task.status).toBe("running")
  })

  it("should NOT interrupt busy session even with no progress (undefined lastUpdate)", async () => {
    //#given — task has no progress at all, but session is busy
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
    })

    //#when — session is busy
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
    })

    //#then — task should survive because session is actively running
    expect(task.status).toBe("running")
  })

  it("should interrupt task when session is idle and lastUpdate exceeds stale timeout", async () => {
    //#given — lastUpdate is 5min old and session is idle
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    })

    //#when — session status is "idle"
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "idle" } },
    })

    //#then — task should be killed because session is idle with stale lastUpdate
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  it("should NOT interrupt running session task even with very old lastUpdate", async () => {
    //#given — lastUpdate is 15min old, but session is still running
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 900_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 900_000),
      },
    })

    //#when — session running, lastUpdate far exceeds any timeout
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "running" } },
    })

    //#then — running sessions are NEVER stale-killed (babysitter + TTL prune handle these)
    expect(task.status).toBe("running")
  })

  it("should NOT interrupt running session even with no progress (undefined lastUpdate)", async () => {
    //#given — task has no progress at all, but session is running
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
    })

    //#when — session is running
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "running" } },
    })

    //#then — running sessions are NEVER killed, even without progress
    expect(task.status).toBe("running")
  })

  it("should use default stale timeout when session status is unknown/missing", async () => {
    //#given — lastUpdate exceeds stale timeout, session not in status map
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 200_000),
      },
    })

    //#when — empty sessionStatuses (session not found)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })

    //#then — unknown session treated as potentially stale, apply default timeout
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  it("should NOT interrupt task when session is busy (OpenCode status), even if lastUpdate exceeds stale timeout", async () => {
    //#given — lastUpdate is 5min old but session is "busy" (OpenCode's actual status for active sessions)
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    })

    //#when — session status is "busy" (not "running" — OpenCode uses "busy" for active LLM processing)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
    })

    //#then — "busy" sessions must be protected from stale-kill
    expect(task.status).toBe("running")
  })

  it("should NOT interrupt task when session is in retry state", async () => {
    //#given — lastUpdate is 5min old but session is retrying
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    })

    //#when — session status is "retry" (OpenCode retries on transient API errors)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "retry" } },
    })

    //#then — retry sessions must be protected from stale-kill
    expect(task.status).toBe("running")
  })

  it("should NOT interrupt busy session even with no progress (undefined lastUpdate)", async () => {
    //#given — no progress at all, session is "busy" (thinking model with no streamed tokens yet)
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
    })

    //#when — session is busy
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
    })

    //#then — busy sessions with no progress must survive
    expect(task.status).toBe("running")
  })

  it("should release concurrency key when interrupting a never-updated task", async () => {
    //#given
    const releaseMock = mock(() => {})
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
      concurrencyKey: "anthropic/claude-opus-4-6",
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: { release: releaseMock } as never,
      notifyParentSession: mockNotify,
    })

    //#then
    expect(releaseMock).toHaveBeenCalledWith("anthropic/claude-opus-4-6")
    expect(task.concurrencyKey).toBeUndefined()
  })
})

describe("pruneStaleTasksAndNotifications", () => {
  it("should prune tasks that exceeded TTL", () => {
    //#given
    const tasks = new Map<string, BackgroundTask>()
    const oldTask: BackgroundTask = {
      id: "old-task",
      parentSessionID: "parent",
      parentMessageID: "msg",
      description: "old",
      prompt: "old",
      agent: "explore",
      status: "running",
      startedAt: new Date(Date.now() - 31 * 60 * 1000),
    }
    tasks.set("old-task", oldTask)

    const pruned: string[] = []
    const notifications = new Map<string, BackgroundTask[]>()

    //#when
    pruneStaleTasksAndNotifications({
      tasks,
      notifications,
      onTaskPruned: (taskId) => pruned.push(taskId),
    })

    //#then
    expect(pruned).toContain("old-task")
  })
})

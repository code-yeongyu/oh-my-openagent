declare const require: (name: string) => any
const { describe, it, expect, mock, spyOn, beforeEach, afterEach } = require("bun:test")

import { checkAndInterruptStaleTasks, pruneStaleTasksAndNotifications } from "./task-poller"
import type { BackgroundTask } from "./types"

describe("checkAndInterruptStaleTasks", () => {
  const mockClient = {
    session: {
      abort: mock(() => Promise.resolve()),
      get: mock(() => Promise.resolve({ data: { id: "ses-1" } })),
    },
  }
  const mockConcurrencyManager = {
    release: mock(() => {}),
  }
  const mockNotify = mock(() => Promise.resolve())

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
  const originalDateNow = Date.now
  let fixedTime: number

  beforeEach(() => {
    fixedTime = Date.now()
    spyOn(globalThis.Date, "now").mockReturnValue(fixedTime)
    mockClient.session.abort.mockClear()
    mockClient.session.get.mockReset()
    mockClient.session.get.mockResolvedValue({ data: { id: "ses-1" } })
    mockConcurrencyManager.release.mockClear()
    mockNotify.mockClear()
  })

  afterEach(() => {
    Date.now = originalDateNow
  })


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
    //#given - task started 15 minutes ago, never received any progress update
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

  it("should await abort before resolving for no-progress stale interruption", async () => {
    //#given
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
    })
    const deferred = createDeferredPromise()
    mockClient.session.abort.mockImplementationOnce(() => deferred.promise)

    //#when
    const interruptPromise = checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
    })
    let settled = false
    void interruptPromise.then(() => {
      settled = true
    })

    await Promise.resolve()

    //#then
    expect(settled).toBe(false)

    deferred.resolve()
    await interruptPromise

    expect(settled).toBe(true)
  })

  it("should NOT interrupt tasks with NO progress.lastUpdate that are within messageStalenessTimeoutMs", async () => {
    //#given - task started 5 minutes ago, default timeout is 10 minutes
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
    //#given - task started 65 minutes ago, no config for messageStalenessTimeoutMs
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 65 * 60 * 1000),
      progress: undefined,
    })

    //#when - default is 60 minutes (3_600_000ms)
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
    //#given - lastUpdate is 5min old but session is actively running
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    })

    //#when - session status is "busy" (OpenCode's actual status for active LLM processing)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
    })

    //#then - task should survive because session is actively busy
    expect(task.status).toBe("running")
  })

  it("should NOT interrupt busy session task even with very old lastUpdate", async () => {
    //#given - lastUpdate is 15min old, but session is still busy
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 900_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 900_000),
      },
    })

    //#when - session busy, lastUpdate far exceeds any timeout
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
    })

    //#then - busy sessions are NEVER stale-killed (babysitter + TTL prune handle these)
    expect(task.status).toBe("running")
  })

  it("should NOT interrupt busy session even with no progress (undefined lastUpdate)", async () => {
    //#given - task has no progress at all, but session is busy
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
    })

    //#when - session is busy
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
    })

    //#then - task should survive because session is actively running
    expect(task.status).toBe("running")
  })

  it("should interrupt task when session is idle and lastUpdate exceeds stale timeout", async () => {
    //#given - lastUpdate is 5min old and session is idle
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    })

    //#when - session status is "idle"
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "idle" } },
    })

    //#then - task should be killed because session is idle with stale lastUpdate
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  it("should NOT interrupt running session task even with very old lastUpdate", async () => {
    //#given - lastUpdate is 15min old, but session is still running
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 900_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 900_000),
      },
    })

    //#when - session running, lastUpdate far exceeds any timeout
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "running" } },
    })

    //#then - running sessions are NEVER stale-killed (babysitter + TTL prune handle these)
    expect(task.status).toBe("running")
  })

  it("should NOT interrupt running session even with no progress (undefined lastUpdate)", async () => {
    //#given - task has no progress at all, but session is running
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

  it("should NOT cancel healthy task on first missing status poll", async () => {
    //#given — one missing poll should not be enough to declare the session gone
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 120_000),
      },
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, sessionGoneTimeoutMs: 60_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })

    //#then
    expect(task.status).toBe("running")
    expect(task.consecutiveMissedPolls).toBe(1)
    expect(mockClient.session.get).not.toHaveBeenCalled()
  })

  it("should NOT cancel task when session.get confirms the session still exists", async () => {
    //#given — repeated missing polls but direct lookup still succeeds
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 120_000),
      },
      consecutiveMissedPolls: 2,
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, sessionGoneTimeoutMs: 60_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })

    //#then
    expect(task.status).toBe("running")
    expect(task.consecutiveMissedPolls).toBe(0)
    expect(mockClient.session.get).toHaveBeenCalledWith({ path: { id: "ses-1" } })
  })

  it("should NOT cancel task when session.get returns a transient error response", async () => {
    //#given — repeated missing polls but lookup failed with a retryable transport error
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 120_000),
      },
      consecutiveMissedPolls: 2,
    })

    mockClient.session.get.mockResolvedValue({
      error: { message: "Network timeout", status: 500 },
      data: undefined,
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, sessionGoneTimeoutMs: 60_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })

    //#then
    expect(task.status).toBe("running")
    expect(task.consecutiveMissedPolls).toBe(0)
    expect(mockClient.session.get).toHaveBeenCalledWith({ path: { id: "ses-1" } })
  })

  it("should use session-gone timeout when session is missing from status map (with progress)", async () => {
    //#given — lastUpdate 2min ago, session completely gone from status
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 120_000),
      },
      consecutiveMissedPolls: 2,
    })

    mockClient.session.get.mockRejectedValue(new Error("missing"))

    //#when — empty sessionStatuses (session gone), sessionGoneTimeoutMs = 60s
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, sessionGoneTimeoutMs: 60_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })

    //#then — cancelled because session gone timeout (60s) < timeSinceLastUpdate (120s)
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("session gone from status registry")
  })

  it("should await abort before resolving for session-gone interruption", async () => {
    //#given
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 120_000),
      },
      consecutiveMissedPolls: 2,
    })
    const deferred = createDeferredPromise()
    mockClient.session.get.mockRejectedValue(new Error("missing"))
    mockClient.session.abort.mockImplementationOnce(() => deferred.promise)

    //#when
    const interruptPromise = checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, sessionGoneTimeoutMs: 60_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })
    let settled = false
    void interruptPromise.then(() => {
      settled = true
    })

    await Promise.resolve()

    //#then
    expect(settled).toBe(false)

    deferred.resolve()
    await interruptPromise

    expect(settled).toBe(true)
  })

  it("should use session-gone timeout when session is missing from status map (no progress)", async () => {
    //#given — task started 2min ago, no progress, session completely gone
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 120_000),
      progress: undefined,
      consecutiveMissedPolls: 2,
    })

    mockClient.session.get.mockRejectedValue(new Error("missing"))

    //#when — session gone, sessionGoneTimeoutMs = 60s
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000, sessionGoneTimeoutMs: 60_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })

    //#then — cancelled because session gone timeout (60s) < runtime (120s)
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("session gone from status registry")
  })

  it("should NOT use session-gone timeout when session is idle (present in status map)", async () => {
    //#given — lastUpdate 2min ago, session is idle (present in status but not active)
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 120_000),
      },
      consecutiveMissedPolls: 2,
    })

    mockClient.session.get.mockRejectedValue(new Error("missing"))

    //#when — session is idle (present in map), staleTimeoutMs = 180s
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, sessionGoneTimeoutMs: 60_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "idle" } },
    })

    //#then — still running because normal staleTimeout (180s) > timeSinceLastUpdate (120s)
    expect(task.status).toBe("running")
  })

  it("should use default session-gone timeout when not configured", async () => {
    //#given — lastUpdate 2min ago, session gone, no sessionGoneTimeoutMs config
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 120_000),
      },
      consecutiveMissedPolls: 2,
    })

    mockClient.session.get.mockRejectedValue(new Error("missing"))

    //#when — no config (default sessionGoneTimeoutMs = 60_000)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: undefined,
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })

    //#then — cancelled because default session gone timeout (60s) < timeSinceLastUpdate (120s)
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("session gone from status registry")
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

  it("should invoke interruption callback immediately when stale task is cancelled", async () => {
    //#given
    const task = createRunningTask({
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 200_000),
      },
    })
    const onTaskInterrupted = mock(() => {})

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      onTaskInterrupted,
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(onTaskInterrupted).toHaveBeenCalledWith(task)
  })

  it('should NOT protect task when session has terminal non-idle status like "interrupted"', async () => {
    //#given — lastUpdate is 5min old, session is "interrupted" (terminal, not active)
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    })

    //#when — session status is "interrupted" (terminal)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "interrupted" } },
    })

    //#then — terminal statuses should not protect from stale timeout
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  it('should NOT protect task when session has unknown status type', async () => {
    //#given — lastUpdate is 5min old, session has an unknown status
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    })

    //#when — session has unknown status type
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "some-weird-status" } },
    })

    //#then — unknown statuses should not protect from stale timeout
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })
})

describe("pruneStaleTasksAndNotifications", () => {
  function createTerminalTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
    return {
      id: "terminal-task",
      parentSessionID: "parent",
      parentMessageID: "msg",
      description: "terminal",
      prompt: "terminal",
      agent: "explore",
      status: "completed",
      startedAt: new Date(Date.now() - 40 * 60 * 1000),
      completedAt: new Date(Date.now() - 31 * 60 * 1000),
      ...overrides,
    }
  }

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

  it("#given running task with recent progress #when startedAt exceeds TTL #then should NOT prune", () => {
    //#given
    const tasks = new Map<string, BackgroundTask>()
    const activeTask: BackgroundTask = {
      id: "active-task",
      parentSessionID: "parent",
      parentMessageID: "msg",
      description: "active",
      prompt: "active",
      agent: "oracle",
      status: "running",
      startedAt: new Date(Date.now() - 45 * 60 * 1000),
      progress: {
        toolCalls: 10,
        lastUpdate: new Date(Date.now() - 5 * 60 * 1000),
      },
    }
    tasks.set("active-task", activeTask)

    const pruned: string[] = []
    const notifications = new Map<string, BackgroundTask[]>()

    //#when
    pruneStaleTasksAndNotifications({
      tasks,
      notifications,
      onTaskPruned: (taskId) => pruned.push(taskId),
    })

    //#then
    expect(pruned).toEqual([])
  })

  it("#given running task with stale progress #when lastUpdate exceeds TTL #then should prune", () => {
    //#given
    const tasks = new Map<string, BackgroundTask>()
    const staleTask: BackgroundTask = {
      id: "stale-task",
      parentSessionID: "parent",
      parentMessageID: "msg",
      description: "stale",
      prompt: "stale",
      agent: "oracle",
      status: "running",
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      progress: {
        toolCalls: 10,
        lastUpdate: new Date(Date.now() - 35 * 60 * 1000),
      },
    }
    tasks.set("stale-task", staleTask)

    const pruned: string[] = []
    const notifications = new Map<string, BackgroundTask[]>()

    //#when
    pruneStaleTasksAndNotifications({
      tasks,
      notifications,
      onTaskPruned: (taskId) => pruned.push(taskId),
    })

    //#then
    expect(pruned).toContain("stale-task")
  })

  it("#given custom taskTtlMs #when task exceeds custom TTL #then should prune", () => {
    //#given
    const tasks = new Map<string, BackgroundTask>()
    const task: BackgroundTask = {
      id: "custom-ttl-task",
      parentSessionID: "parent",
      parentMessageID: "msg",
      description: "custom",
      prompt: "custom",
      agent: "explore",
      status: "running",
      startedAt: new Date(Date.now() - 61 * 60 * 1000),
    }
    tasks.set("custom-ttl-task", task)

    const pruned: string[] = []
    const notifications = new Map<string, BackgroundTask[]>()

    //#when
    pruneStaleTasksAndNotifications({
      tasks,
      notifications,
      taskTtlMs: 60 * 60 * 1000,
      onTaskPruned: (taskId) => pruned.push(taskId),
    })

    //#then
    expect(pruned).toContain("custom-ttl-task")
  })

  it("#given custom taskTtlMs #when task within custom TTL #then should NOT prune", () => {
    //#given
    const tasks = new Map<string, BackgroundTask>()
    const task: BackgroundTask = {
      id: "within-ttl-task",
      parentSessionID: "parent",
      parentMessageID: "msg",
      description: "within",
      prompt: "within",
      agent: "explore",
      status: "running",
      startedAt: new Date(Date.now() - 45 * 60 * 1000),
    }
    tasks.set("within-ttl-task", task)

    const pruned: string[] = []
    const notifications = new Map<string, BackgroundTask[]>()

    //#when
    pruneStaleTasksAndNotifications({
      tasks,
      notifications,
      taskTtlMs: 60 * 60 * 1000,
      onTaskPruned: (taskId) => pruned.push(taskId),
    })

    //#then
    expect(pruned).toEqual([])
  })

  it("should prune terminal tasks when completion time exceeds terminal TTL", () => {
    //#given
    const tasks = new Map<string, BackgroundTask>()
    const terminalStatuses: BackgroundTask["status"][] = ["completed", "error", "cancelled", "interrupt"]

    for (const status of terminalStatuses) {
      tasks.set(status, createTerminalTask({
        id: status,
        description: status,
        prompt: status,
        status,
      }))
    }

    const pruned: string[] = []

    //#when
    pruneStaleTasksAndNotifications({
      tasks,
      notifications: new Map<string, BackgroundTask[]>(),
      onTaskPruned: (taskId) => pruned.push(taskId),
    })

    //#then
    expect(pruned).toEqual([])
    expect(Array.from(tasks.keys())).toEqual([])
  })

  it("should keep terminal tasks with pending notifications until notification cleanup", () => {
    //#given
    const task = createTerminalTask()
    const tasks = new Map<string, BackgroundTask>([[task.id, task]])
    const notifications = new Map<string, BackgroundTask[]>([[task.parentSessionID, [task]]])
    const pruned: string[] = []

    //#when
    pruneStaleTasksAndNotifications({
      tasks,
      notifications,
      onTaskPruned: (taskId) => pruned.push(taskId),
    })

    //#then
    expect(pruned).toEqual([])
    expect(tasks.has(task.id)).toBe(true)
    expect(notifications.has(task.parentSessionID)).toBe(false)
  })
})

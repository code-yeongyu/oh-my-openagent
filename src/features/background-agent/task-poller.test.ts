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
      sessionId: "ses-1",
      parentSessionId: "parent-ses-1",
      parentMessageId: "msg-1",
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

  it("should NOT interrupt idle team-member tasks just because lastUpdate is old", async () => {
    //#given
    const task = createRunningTask({
      teamRunId: "team-run-1",
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
      sessionStatuses: { "ses-1": { type: "idle" } },
    })

    //#then
    expect(task.status).toBe("running")
  })

  it("should still interrupt team-member tasks when the session is gone", async () => {
    //#given
    const task = createRunningTask({
      teamRunId: "team-run-1",
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 200_000),
      },
      consecutiveMissedPolls: 2,
    })
    mockClient.session.get.mockRejectedValueOnce(new Error("missing"))

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, sessionGoneTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("session gone from status registry")
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
    expect(task.error).toContain("messageStalenessTimeoutMs")
  })

  it("should keep never-updated task running when stale abort returns SDK error", async () => {
    //#given
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
      concurrencyKey: "anthropic/claude-opus-4-7",
    })
    const releaseMock = mock(() => {})
    const onTaskInterrupted = mock(() => {})
    mockClient.session.abort.mockImplementationOnce(() => Promise.resolve({ error: { message: "still running" } }))

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: { release: releaseMock } as never,
      notifyParentSession: mockNotify,
      onTaskInterrupted,
    })

    //#then
    expect(task.status).toBe("running")
    expect(task.error).toBeUndefined()
    expect(task.concurrencyKey).toBe("anthropic/claude-opus-4-7")
    expect(releaseMock).not.toHaveBeenCalled()
    expect(onTaskInterrupted).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
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
    //#given - task started 5 minutes ago (within explicit 10m config; long kill default is 60m)
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
    //#given - task started 70 minutes ago (exceeds restored 60min default), no config for messageStalenessTimeoutMs
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 70 * 60 * 1000),
      progress: undefined,
    })

    //#when - default is 60 minutes (3_600_000ms) for kill (stall notification uses separate 5-10min via injector)
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

  it("should NOT interrupt busy session when progress is within the configured stale timeout", async () => {
    //#given - session is busy and progress was observed recently
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 60_000),
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

    //#then
    expect(task.status).toBe("running")
  })

  it("should interrupt busy session task when lastUpdate exceeds stale timeout", async () => {
    //#given - the session still reports busy, but no progress arrived within the configured timeout
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

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  it("should keep stale-progress task running when abort returns SDK error", async () => {
    //#given
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 900_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 900_000),
      },
      concurrencyKey: "anthropic/claude-opus-4-7",
    })
    const releaseMock = mock(() => {})
    const onTaskInterrupted = mock(() => {})
    mockClient.session.abort.mockImplementationOnce(() => Promise.resolve({ error: { message: "still running" } }))

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: { release: releaseMock } as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
      onTaskInterrupted,
    })

    //#then
    expect(task.status).toBe("running")
    expect(task.error).toBeUndefined()
    expect(task.concurrencyKey).toBe("anthropic/claude-opus-4-7")
    expect(releaseMock).not.toHaveBeenCalled()
    expect(onTaskInterrupted).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it("should abort multiple stale-progress tasks concurrently before marking them cancelled", async () => {
    //#given
    const firstAbort = createDeferredPromise()
    const secondAbort = createDeferredPromise()
    const abortSessionIDs: string[] = []
    const taskA = createRunningTask({
      id: "task-stale-a",
      sessionId: "ses-stale-a",
      parentSessionId: "parent-stale-a",
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 900_000),
      },
    })
    const taskB = createRunningTask({
      id: "task-stale-b",
      sessionId: "ses-stale-b",
      parentSessionId: "parent-stale-b",
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 900_000),
      },
    })
    mockClient.session.abort.mockImplementation(({ path }: { path: { id: string } }) => {
      abortSessionIDs.push(path.id)
      return path.id === "ses-stale-a" ? firstAbort.promise : secondAbort.promise
    })

    //#when
    const interruption = checkAndInterruptStaleTasks({
      tasks: [taskA, taskB],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
    })
    await Promise.resolve()

    //#then
    expect(abortSessionIDs).toEqual(["ses-stale-a", "ses-stale-b"])
    expect(taskA.status).toBe("running")
    expect(taskB.status).toBe("running")

    firstAbort.resolve()
    secondAbort.resolve()
    await interruption

    expect(taskA.status).toBe("cancelled")
    expect(taskB.status).toBe("cancelled")
  })

  it("should NOT interrupt busy session with no progress within message staleness timeout", async () => {
    //#given - task has no progress yet, but it is still inside the configured first-progress window
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 5 * 60 * 1000),
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

    //#then
    expect(task.status).toBe("running")
  })

  it("should interrupt busy session when it exceeds configured no-progress timeout", async () => {
    //#given - the session reports busy, but no progress event arrived within the configured timeout
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
      sessionStatuses: { "ses-1": { type: "busy" } },
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("no activity")
    expect(mockNotify).toHaveBeenCalledWith(task)
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

  it("should interrupt running session task when lastUpdate exceeds stale timeout", async () => {
    //#given - the session reports running, but no progress arrived within the configured timeout
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

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  it("should interrupt running session with no progress after message staleness timeout", async () => {
    //#given - the session reports running, but no progress ever arrived within the configured timeout
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
    })

    //#when - session is running
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "running" } },
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("no activity")
  })

  it("should NOT cancel healthy task on first missing status poll", async () => {
    //#given - one missing poll should not be enough to declare the session gone
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
    //#given - repeated missing polls but direct lookup still succeeds
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

  it("should NOT cancel or reset missed polls when session.get returns a transient error response", async () => {
    //#given - repeated missing polls but lookup failed with a retryable transport error
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
    expect(task.consecutiveMissedPolls).toBe(3)
    expect(mockClient.session.get).toHaveBeenCalledWith({ path: { id: "ses-1" } })
  })

  it("should use session-gone timeout when session is missing from status map (with progress)", async () => {
    //#given - lastUpdate 2min ago, session completely gone from status
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 120_000),
      },
      consecutiveMissedPolls: 2,
    })

    mockClient.session.get.mockRejectedValue(new Error("missing"))

    //#when - empty sessionStatuses (session gone), sessionGoneTimeoutMs = 60s
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, sessionGoneTimeoutMs: 60_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })

    //#then - cancelled because session gone timeout (60s) < timeSinceLastUpdate (120s)
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
    //#given - task started 2min ago, no progress, session completely gone
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 120_000),
      progress: undefined,
      consecutiveMissedPolls: 2,
    })

    mockClient.session.get.mockRejectedValue(new Error("missing"))

    //#when - session gone, sessionGoneTimeoutMs = 60s
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000, sessionGoneTimeoutMs: 60_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })

    //#then - cancelled because session gone timeout (60s) < runtime (120s)
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("session gone from status registry")
  })

  it("should NOT use session-gone timeout when session is idle (present in status map)", async () => {
    //#given - lastUpdate 2min ago, session is idle (present in status but not active)
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 120_000),
      },
      consecutiveMissedPolls: 2,
    })

    mockClient.session.get.mockRejectedValue(new Error("missing"))

    //#when - session is idle (present in map), staleTimeoutMs = 180s
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, sessionGoneTimeoutMs: 60_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "idle" } },
    })

    //#then - still running because normal staleTimeout (180s) > timeSinceLastUpdate (120s)
    expect(task.status).toBe("running")
  })

  it("should use default session-gone timeout when not configured", async () => {
    //#given - lastUpdate 2min ago, session gone, no sessionGoneTimeoutMs config
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 120_000),
      },
      consecutiveMissedPolls: 2,
    })

    mockClient.session.get.mockRejectedValue(new Error("missing"))

    //#when - no config (default sessionGoneTimeoutMs = 60_000)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: undefined,
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })

    //#then - cancelled because default session gone timeout (60s) < timeSinceLastUpdate (120s)
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("session gone from status registry")
  })

  it("should interrupt task when busy session exceeds stale timeout", async () => {
    //#given - lastUpdate is 5min old and session is still "busy"
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    })

    //#when - session status is "busy" (not "running" - OpenCode uses "busy" for active LLM processing)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  it("should interrupt task when retry session exceeds stale timeout", async () => {
    //#given - lastUpdate is 5min old but session is retrying
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    })

    //#when - session status is "retry" (OpenCode retries on transient API errors)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "retry" } },
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  it("should interrupt busy session with no progress after message staleness timeout", async () => {
    //#given - no progress at all, session is still "busy"
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

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("no activity")
  })

  it("should release concurrency key when interrupting a never-updated task", async () => {
    //#given
    const releaseMock = mock(() => {})
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
      concurrencyKey: "anthropic/claude-opus-4-7",
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
    expect(releaseMock).toHaveBeenCalledWith("anthropic/claude-opus-4-7")
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
    //#given - lastUpdate is 5min old, session is "interrupted" (terminal, not active)
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    })

    //#when - session status is "interrupted" (terminal)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "interrupted" } },
    })

    //#then - terminal statuses should not protect from stale timeout
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  it('should NOT protect task when session has unknown status type', async () => {
    //#given - lastUpdate is 5min old, session has an unknown status
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    })

    //#when - session has unknown status type
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "some-weird-status" } },
    })

    //#then - unknown statuses should not protect from stale timeout
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  // New coverage for stall detection feature: exercise progress timestamps + lastUpdate paths
  // with restored long kill defaults (45m/60m). This ensures stall-injector (5m/10m notify)
  // can alert main agent via injected status messages long before any kill risk.
  it("should NOT interrupt running task with moderately old lastUpdate (7min) under default long stale kill timeout", async () => {
    //#given - lastUpdate 7min ago; kill default now 45min (safe for long tasks); stall notify would trigger at 5m via injector
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 20 * 60 * 1000),
      progress: {
        toolCalls: 42,
        lastTool: "analyze",
        lastUpdate: new Date(Date.now() - 7 * 60 * 1000),
      },
    })

    //#when - no explicit config, uses long DEFAULT_STALE_TIMEOUT_MS
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: undefined,
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
    })

    //#then - still running (7m < 45m); injector hook will have injected stall warning status into main chat
    expect(task.status).toBe("running")
  })

  it("should NOT interrupt task with no progress updates yet when within long DEFAULT_MESSAGE_STALENESS (20min < 60min)", async () => {
    //#given - 20min since start, no lastUpdate/progress; long default 60min protects legit slow-starting tasks
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 20 * 60 * 1000),
      progress: undefined,
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: undefined,
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
    })

    //#then - not killed (would have been with old 10m default); stall-injector may notify using startedAt at its 5-10m thresholds
    expect(task.status).toBe("running")
  })
})

describe("pruneStaleTasksAndNotifications", () => {
  function createTerminalTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
    return {
      id: "terminal-task",
      parentSessionId: "parent",
      parentMessageId: "msg",
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
      parentSessionId: "parent",
      parentMessageId: "msg",
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
      parentSessionId: "parent",
      parentMessageId: "msg",
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
      parentSessionId: "parent",
      parentMessageId: "msg",
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

  it("#given running task with stale progress and active session #when lastUpdate exceeds TTL #then should NOT prune", () => {
    //#given
    const tasks = new Map<string, BackgroundTask>()
    const activeTask: BackgroundTask = {
      id: "active-status-task",
      sessionId: "ses-active-status",
      parentSessionId: "parent",
      parentMessageId: "msg",
      description: "active status",
      prompt: "active status",
      agent: "oracle",
      status: "running",
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      progress: {
        toolCalls: 10,
        lastUpdate: new Date(Date.now() - 35 * 60 * 1000),
      },
    }
    tasks.set("active-status-task", activeTask)

    const pruned: string[] = []
    const notifications = new Map<string, BackgroundTask[]>()

    //#when
    pruneStaleTasksAndNotifications({
      tasks,
      notifications,
      sessionStatuses: { "ses-active-status": { type: "busy" } },
      onTaskPruned: (taskId) => pruned.push(taskId),
    })

    //#then
    expect(pruned).toEqual([])
    expect(tasks.has("active-status-task")).toBe(true)
  })

  it("#given custom taskTtlMs #when task exceeds custom TTL #then should prune", () => {
    //#given
    const tasks = new Map<string, BackgroundTask>()
    const task: BackgroundTask = {
      id: "custom-ttl-task",
      parentSessionId: "parent",
      parentMessageId: "msg",
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
      parentSessionId: "parent",
      parentMessageId: "msg",
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

  it("#given active team-member task with stale progress #when prune runs #then should NOT prune", () => {
    //#given
    const tasks = new Map<string, BackgroundTask>()
    const task: BackgroundTask = {
      id: "team-task",
      sessionID: "ses-team-1",
      parentSessionID: "parent",
      parentMessageID: "msg",
      teamRunId: "team-run-1",
      description: "team member",
      prompt: "team member",
      agent: "sisyphus-junior",
      status: "running",
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 35 * 60 * 1000),
      },
    }
    tasks.set(task.id, task)

    const pruned: string[] = []

    //#when
    pruneStaleTasksAndNotifications({
      tasks,
      notifications: new Map<string, BackgroundTask[]>(),
      onTaskPruned: (taskId) => pruned.push(taskId),
    })

    //#then
    expect(pruned).toEqual([])
    expect(tasks.has(task.id)).toBe(true)
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
    const notifications = new Map<string, BackgroundTask[]>([[task.parentSessionId, [task]]])
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
    expect(notifications.has(task.parentSessionId)).toBe(false)
  })
})

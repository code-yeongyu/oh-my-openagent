import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { checkAndInterruptStaleTasks } from "./task-poller"
import type { BackgroundTask } from "./types"

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

describe("checkAndInterruptStaleTasks persisted session activity", () => {
  const mockClient = unsafeTestValue<Parameters<typeof checkAndInterruptStaleTasks>[0]["client"]>({
    session: {
      abort: mock(() => Promise.resolve()),
      get: mock(() => Promise.resolve({ data: { id: "ses-1" } })),
    },
  })
  const mockConcurrencyManager = unsafeTestValue<Parameters<typeof checkAndInterruptStaleTasks>[0]["concurrencyManager"]>({
    release: mock(() => {}),
  })
  const mockNotify = mock(() => Promise.resolve())

  const originalDateNow = Date.now
  const fixedTime = new Date("2026-05-21T03:00:00.000Z").getTime()

  afterEach(() => {
    Date.now = originalDateNow
    mockClient.session.abort.mockClear()
    mockConcurrencyManager.release.mockClear()
    mockNotify.mockClear()
  })

  test("keeps a busy task running when persisted session activity is fresh", async () => {
    //#given - in-memory progress is stale, but OpenCode storage shows recent child-session activity
    spyOn(globalThis.Date, "now").mockReturnValue(fixedTime)
    const staleActivity = new Date(Date.now() - 45 * 60 * 1000)
    const freshActivity = new Date(Date.now() - 10_000)
    const task = createRunningTask({
      startedAt: staleActivity,
      progress: {
        toolCalls: 2,
        lastUpdate: staleActivity,
      },
    })

    //#when - stale checking can refresh activity from the persisted session timestamp
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
      getSessionActivity: async () => ({ type: "activity", activity: freshActivity }),
    })

    //#then - task stays running and future stale checks use the persisted activity timestamp
    expect(task.status).toBe("running")
    expect(task.progress?.lastUpdate).toEqual(freshActivity)
    expect(mockNotify).not.toHaveBeenCalled()
  })

  test("keeps a busy task with no local progress running when persisted session activity is fresh", async () => {
    //#given - no progress event reached the manager, but OpenCode storage shows recent activity
    spyOn(globalThis.Date, "now").mockReturnValue(fixedTime)
    const staleStart = new Date(Date.now() - 15 * 60 * 1000)
    const freshActivity = new Date(Date.now() - 10_000)
    const task = createRunningTask({
      startedAt: staleStart,
      progress: undefined,
    })

    //#when - message staleness confirmation refreshes from persisted session metadata
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient,
      config: { messageStalenessTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
      getSessionActivity: async () => ({ type: "activity", activity: freshActivity }),
    })

    //#then - the task stays running and receives a progress timestamp for future stale checks
    expect(task.status).toBe("running")
    expect(task.progress?.lastUpdate).toEqual(freshActivity)
    expect(mockNotify).not.toHaveBeenCalled()
  })

  test("cancels a busy task when persisted session activity is also stale", async () => {
    //#given - local progress is older than persisted activity, but both are outside the stale window
    spyOn(globalThis.Date, "now").mockReturnValue(fixedTime)
    const localActivity = new Date(Date.now() - 45 * 60 * 1000)
    const stalePersistedActivity = new Date(Date.now() - 10 * 60 * 1000)
    const task = createRunningTask({
      startedAt: localActivity,
      progress: {
        toolCalls: 2,
        lastUpdate: localActivity,
      },
    })

    //#when - the persisted timestamp confirms the child session is truly stale
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
      getSessionActivity: async () => ({ type: "activity", activity: stalePersistedActivity }),
    })

    //#then - cancellation still happens, but the stale age reflects persisted activity
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
    expect(task.error).toContain("10min")
    expect(task.progress?.lastUpdate).toEqual(stalePersistedActivity)
    expect(mockNotify).toHaveBeenCalledWith(task)
  })

  test("keeps a busy task running when persisted session activity lookup is unavailable", async () => {
    //#given - the child session is active, but session.get returned an error response during confirmation
    spyOn(globalThis.Date, "now").mockReturnValue(fixedTime)
    const staleActivity = new Date(Date.now() - 45 * 60 * 1000)
    const task = createRunningTask({
      startedAt: staleActivity,
      progress: {
        toolCalls: 2,
        lastUpdate: staleActivity,
      },
    })

    //#when - stale checking cannot verify persisted activity for this poll
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
      getSessionActivity: async () => ({ type: "unavailable" }),
    })

    //#then - active-session cancellation is deferred instead of treating lookup failure as inactivity
    expect(task.status).toBe("running")
    expect(task.progress?.lastUpdate).toEqual(staleActivity)
    expect(mockNotify).not.toHaveBeenCalled()
  })
})

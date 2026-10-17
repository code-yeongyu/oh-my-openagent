import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { checkAndInterruptStaleTasks } from "./task-poller"
import type { BackgroundTask } from "./types"

describe("checkAndInterruptStaleTasks abort failure on a confirmed-gone session", () => {
  const originalDateNow = Date.now
  const fixedTime = new Date("2026-09-07T03:00:00.000Z").getTime()

  afterEach(() => {
    Date.now = originalDateNow
  })

  test("finalizes a stale task whose session is gone even when abort fails", async () => {
    //#given - the session is gone from the status registry and from storage, and abort can no longer reach it
    spyOn(globalThis.Date, "now").mockReturnValue(fixedTime)
    const staleActivity = new Date(fixedTime - 45 * 60 * 1000)
    const task: BackgroundTask = {
      id: "task-1",
      sessionId: "ses-1",
      parentSessionId: "parent-ses-1",
      parentMessageId: "msg-1",
      description: "test",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: staleActivity,
      progress: { toolCalls: 2, lastUpdate: staleActivity },
      consecutiveMissedPolls: 3,
    }
    const client = unsafeTestValue<Parameters<typeof checkAndInterruptStaleTasks>[0]["client"]>({
      session: {
        abort: mock(() => Promise.reject(new Error("session abort failed"))),
        get: mock(() => Promise.resolve({ error: { status: 404, message: "session not found" } })),
      },
    })
    const notify = mock(() => Promise.resolve())

    //#when - the stale sweep runs well past the session-gone timeout
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client,
      config: { staleTimeoutMs: 60_000, sessionGoneTimeoutMs: 60_000 },
      concurrencyManager: unsafeTestValue<Parameters<typeof checkAndInterruptStaleTasks>[0]["concurrencyManager"]>({
        release: mock(() => {}),
      }),
      notifyParentSession: notify,
      sessionStatuses: {},
    })

    //#then - the task is cancelled and the parent is told, instead of waiting on a session that no longer exists
    expect(task.status).toBe("cancelled")
    expect(notify).toHaveBeenCalledTimes(1)
  })
})


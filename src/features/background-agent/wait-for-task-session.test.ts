import { describe, expect, test } from "bun:test"

import type { BackgroundTaskStatus } from "./types"
import { waitForTaskSessionID } from "./wait-for-task-session"

interface TaskSnapshot {
  sessionID?: string
  status?: BackgroundTaskStatus
}

function createManager(responses: TaskSnapshot[]) {
  let index = 0

  return {
    getTask(_taskID: string): TaskSnapshot {
      const response = responses[Math.min(index, responses.length - 1)]
      index += 1
      return response
    },
  }
}

describe("waitForTaskSessionID", () => {
  test("#given task already has a session id #when waiting #then it returns immediately", async () => {
    // given
    const manager = createManager([{ sessionID: "ses_ready_123", status: "running" }])

    // when
    const sessionID = await waitForTaskSessionID(manager, "bg_ready")

    // then
    expect(sessionID).toBe("ses_ready_123")
  })

  test("#given session appears later #when waiting #then it polls until resolved", async () => {
    // given
    const manager = createManager([
      { status: "running" },
      { status: "running" },
      { sessionID: "ses_late_123", status: "running" },
    ])

    // when
    const sessionID = await waitForTaskSessionID(manager, "bg_late", {
      intervalMs: 1,
      timeoutMs: 20,
    })

    // then
    expect(sessionID).toBe("ses_late_123")
  })

  test("#given aborted signal #when waiting #then it returns undefined", async () => {
    // given
    const controller = new AbortController()
    controller.abort()
    const manager = createManager([{ status: "running" }])

    // when
    const sessionID = await waitForTaskSessionID(manager, "bg_abort", {
      signal: controller.signal,
    })

    // then
    expect(sessionID).toBeUndefined()
  })

  test("#given task never resolves #when waiting past timeout #then it returns undefined", async () => {
    // given
    const manager = createManager([{ status: "running" }, { status: "running" }, { status: "running" }])

    // when
    const sessionID = await waitForTaskSessionID(manager, "bg_timeout", {
      intervalMs: 1,
      timeoutMs: 3,
    })

    // then
    expect(sessionID).toBeUndefined()
  })

  test.each(["error", "cancelled", "interrupt"] satisfies BackgroundTaskStatus[])(
    "#given %s task state #when waiting #then it returns undefined",
    async (status: BackgroundTaskStatus) => {
      // given
      const manager = createManager([{ status }])

      // when
      const sessionID = await waitForTaskSessionID(manager, `bg_${status}`)

      // then
      expect(sessionID).toBeUndefined()
    }
  )
})

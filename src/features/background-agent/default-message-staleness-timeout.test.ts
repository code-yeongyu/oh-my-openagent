declare const require: (name: string) => any
const { describe, expect, test, mock } = require("bun:test")

import { DEFAULT_MESSAGE_STALENESS_TIMEOUT_MS } from "./constants"
import { checkAndInterruptStaleTasks } from "./task-poller"
import type { BackgroundTask } from "./types"

function createRunningTask(startedAt: Date): BackgroundTask {
  return {
    id: "task-1",
    sessionID: "ses-1",
    parentSessionID: "parent-ses-1",
    parentMessageID: "msg-1",
    description: "test",
    prompt: "test",
    agent: "explore",
    status: "running",
    startedAt,
    progress: undefined,
  }
}

describe("DEFAULT_MESSAGE_STALENESS_TIMEOUT_MS", () => {
  test("uses a 60 minute default", () => {
    // #given
    const expectedTimeout = 60 * 60 * 1000

    // #when
    const timeout = DEFAULT_MESSAGE_STALENESS_TIMEOUT_MS

    // #then
    expect(timeout).toBe(expectedTimeout)
  })

  test("does not interrupt a never-updated task after 15 minutes when config is omitted", async () => {
    // #given
    const task = createRunningTask(new Date(Date.now() - 15 * 60 * 1000))
    const client = {
      session: {
        abort: mock(() => Promise.resolve()),
      },
    }
    const concurrencyManager = {
      release: mock(() => {}),
    }
    const notifyParentSession = mock(() => Promise.resolve())

    // #when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: client as never,
      config: undefined,
      concurrencyManager: concurrencyManager as never,
      notifyParentSession,
    })

    // #then
    expect(task.status).toBe("running")
  })
})

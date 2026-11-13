import { describe, expect, mock, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { checkAndInterruptStaleTasks } from "./task-poller"
import type { BackgroundTask } from "./types"

type StaleSweepArgs = Parameters<typeof checkAndInterruptStaleTasks>[0]

const UNREACHABLE_MESSAGE = "Unable to connect. Is the computer able to access the url?"
const MINUTE_MS = 60 * 1000

function unreachableClient(): StaleSweepArgs["client"] {
  const reject = () => Promise.reject(new Error(UNREACHABLE_MESSAGE))
  return unsafeTestValue<StaleSweepArgs["client"]>({
    session: {
      abort: mock(reject),
      get: mock(reject),
      status: mock(reject),
    },
  })
}

function runningTask(lastUpdate: Date): BackgroundTask {
  return {
    id: "task-1",
    sessionId: "ses-1",
    parentSessionId: "parent-ses-1",
    parentMessageId: "msg-1",
    description: "test",
    prompt: "test",
    agent: "explore",
    status: "running",
    startedAt: lastUpdate,
    progress: { toolCalls: 2, lastUpdate },
  }
}

async function sweep(task: BackgroundTask): Promise<ReturnType<typeof mock>> {
  const notify = mock(() => Promise.resolve())
  await checkAndInterruptStaleTasks({
    tasks: [task],
    client: unreachableClient(),
    config: undefined,
    concurrencyManager: unsafeTestValue<StaleSweepArgs["concurrencyManager"]>({ release: mock(() => {}) }),
    notifyParentSession: notify,
    sessionStatuses: undefined,
  })
  return notify
}

describe("checkAndInterruptStaleTasks while the OpenCode server is unreachable", () => {
  test("#given a task stale past the default timeout #when every session call rejects as unreachable #then the task is finalized and the parent is told once", async () => {
    const task = runningTask(new Date(Date.now() - 46 * MINUTE_MS))

    const notify = await sweep(task)

    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
    expect(notify).toHaveBeenCalledTimes(1)
  })

  test("#given a task with recent activity #when every session call rejects as unreachable #then the task keeps running and the parent is not told", async () => {
    const task = runningTask(new Date(Date.now() - 5 * MINUTE_MS))

    const notify = await sweep(task)

    expect(task.status).toBe("running")
    expect(notify).not.toHaveBeenCalled()
  })
})

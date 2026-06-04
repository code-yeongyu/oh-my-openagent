import { describe, expect, test, afterEach } from "bun:test"

import type { BackgroundTask } from "../../features/background-agent"
import type { BackgroundOutputClient } from "./clients"
import { formatFullSession } from "./full-session-format"
import { formatTaskResult } from "./task-result-format"
import { _setBackgroundOutputFetchTimeoutMsForTesting } from "./with-sdk-call-timeout"

function createTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-hang",
    sessionId: "ses-hang",
    parentSessionId: "main-1",
    parentMessageId: "msg-1",
    description: "background task that hangs on session.messages",
    prompt: "do work",
    agent: "test-agent",
    status: "completed",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    completedAt: new Date("2026-01-01T00:00:05.000Z"),
    ...overrides,
  }
}

function createNeverSettlingClient(): BackgroundOutputClient {
  return {
    session: {
      messages: () => new Promise(() => {}),
    },
  }
}

describe("background_output session.messages timeout protection", () => {
  afterEach(() => {
    _setBackgroundOutputFetchTimeoutMsForTesting(undefined)
  })

  describe("#given session.messages never resolves", () => {
    test("#when formatTaskResult runs #then it resolves to an error string within the fetch timeout instead of hanging", async () => {
      // given
      _setBackgroundOutputFetchTimeoutMsForTesting(50)
      const task = createTask()
      const client = createNeverSettlingClient()

      // when
      const start = Date.now()
      const output = await formatTaskResult(task, client)
      const elapsed = Date.now() - start

      // then
      expect(elapsed).toBeLessThan(2000)
      expect(output).toContain("Error fetching messages")
      expect(output).toContain("timed out")
    })

    test("#when formatFullSession runs #then it resolves to an error string within the fetch timeout instead of hanging", async () => {
      // given
      _setBackgroundOutputFetchTimeoutMsForTesting(50)
      const task = createTask()
      const client = createNeverSettlingClient()

      // when
      const start = Date.now()
      const output = await formatFullSession(task, client, {
        includeThinking: false,
        includeToolResults: false,
      })
      const elapsed = Date.now() - start

      // then
      expect(elapsed).toBeLessThan(2000)
      expect(output).toContain("Error fetching messages")
      expect(output).toContain("timed out")
    })

    test("#when two parallel formatTaskResult callers share a hung sessionID #then both resolve within the fetch timeout", async () => {
      // given
      _setBackgroundOutputFetchTimeoutMsForTesting(50)
      const task = createTask()
      const client = createNeverSettlingClient()

      // when
      const start = Date.now()
      const [first, second] = await Promise.all([
        formatTaskResult(task, client),
        formatTaskResult(task, client),
      ])
      const elapsed = Date.now() - start

      // then
      expect(elapsed).toBeLessThan(2000)
      expect(first).toContain("Error fetching messages")
      expect(second).toContain("Error fetching messages")
    })
  })
})

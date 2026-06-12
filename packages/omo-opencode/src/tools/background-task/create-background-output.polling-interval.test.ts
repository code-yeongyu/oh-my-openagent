/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import type { BackgroundTask } from "../../features/background-agent"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createBackgroundOutput } from "./create-background-output"
import type { BackgroundOutputClient, BackgroundOutputManager } from "./clients"

const mockContext = unsafeTestValue<Parameters<ReturnType<typeof createBackgroundOutput>["execute"]>[1]>({
  sessionID: "ses_parent",
  messageID: "msg_parent",
  agent: "sisyphus",
  abort: new AbortController().signal,
})

function createTask(): BackgroundTask {
  return {
    id: "bg_fast_poll",
    sessionId: "ses_fast_poll",
    parentSessionId: "ses_parent",
    parentMessageId: "msg_parent",
    description: "fast poll",
    prompt: "run",
    agent: "sisyphus-junior",
    status: "running",
  }
}

const client: BackgroundOutputClient = {
  session: {
    messages: async () => ({
      data: [
        {
          info: { role: "assistant", time: "2026-01-01T00:00:00Z" },
          parts: [{ type: "text", text: "completed result" }],
        },
      ],
    }),
  },
}

describe("background_output blocking poll interval", () => {
  test("#given a short blocking timeout and a task that completes on retry #when fetching output #then it does not sleep for the legacy one second interval", async () => {
    // given
    let pollCount = 0
    const task = createTask()
    const manager: BackgroundOutputManager = {
      getTask: (id: string) => {
        if (id !== task.id) return undefined
        pollCount += 1
        if (pollCount >= 3) {
          task.status = "completed"
        }
        return task
      },
    }
    const tool = createBackgroundOutput(manager, client)
    const startedAt = Date.now()

    // when
    const output = await tool.execute({
      task_id: task.id,
      block: true,
      timeout: 30,
    }, mockContext)

    // then
    expect(Date.now() - startedAt).toBeLessThan(200)
    expect(pollCount).toBeGreaterThanOrEqual(3)
    expect(output).toContain("completed result")
  })
})

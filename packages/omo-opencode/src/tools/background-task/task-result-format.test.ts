import { describe, expect, test } from "bun:test"

import type { BackgroundTask } from "../../features/background-agent"
import type { BackgroundOutputClient, BackgroundOutputMessage } from "./clients"
import { formatTaskResult } from "./task-result-format"

function createTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    sessionId: "ses-1",
    parentSessionId: "main-1",
    parentMessageId: "msg-1",
    description: "background task",
    prompt: "do work",
    agent: "test-agent",
    status: "completed",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    completedAt: new Date("2026-01-01T00:00:05.000Z"),
    ...overrides,
  }
}

describe("formatTaskResult", () => {
  test("returns assistant session errors instead of masking them as success text", async () => {
    const task = createTask()
    const client: BackgroundOutputClient = {
      session: {
        messages: async () => ({
          data: [
            {
              info: {
                role: "assistant",
                time: { created: 1 },
                error: { data: { message: "Forbidden: Selected provider is forbidden" } },
              },
              parts: [],
            },
          ],
        }),
      },
    }

    const output = await formatTaskResult(task, client)

    expect(output).toContain("Session error")
    expect(output).toContain("Forbidden: Selected provider is forbidden")
  })

  test("#given an old abort and a newer report #when collecting twice #then only the first read returns the report", async () => {
    const task = createTask({ sessionId: "ses-resumed-success" })
    const data: BackgroundOutputMessage[] = [
      {
        info: { role: "assistant", time: { created: 1 }, error: { data: { message: "Aborted" } } },
        parts: [],
      },
      {
        info: { role: "assistant", time: { created: 2 } },
        parts: [{ type: "text", text: "CONTINUATION_REPORT" }],
      },
    ]
    const client: BackgroundOutputClient = { session: { messages: async () => ({ data }) } }

    const output = await formatTaskResult(task, client)
    const repeated = await formatTaskResult(task, client)

    expect(output).toContain("CONTINUATION_REPORT")
    expect(output).not.toContain("Session error")
    expect(repeated).toContain("No new output since last check")
    expect(repeated).not.toContain("Aborted")
  })

  test("#given an old abort and a new provider error #when collecting #then the current error is returned", async () => {
    const task = createTask({ sessionId: "ses-resumed-error" })
    const client: BackgroundOutputClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { role: "assistant", time: { created: 1 }, error: { data: { message: "Aborted" } } } },
            {
              info: {
                role: "assistant",
                time: { created: 2 },
                error: { data: { message: "Continuation provider failed" } },
              },
            },
          ],
        }),
      },
    }

    const output = await formatTaskResult(task, client)

    expect(output).toContain("Session error: Continuation provider failed")
    expect(output).not.toContain("Aborted")
  })
})

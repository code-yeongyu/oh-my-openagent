import { afterEach, describe, expect, test } from "bun:test"

import type { BackgroundTask } from "../../features/background-agent"
import { resetMessageCursor } from "../../shared/session-cursor"
import type { BackgroundOutputClient } from "./clients"
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
  afterEach(() => {
    resetMessageCursor()
  })

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

  test("returns only the final assistant answer", async () => {
    const client: BackgroundOutputClient = {
      session: {
        messages: async () => ({
          data: [
            {
              info: { role: "assistant", time: "2026-01-01T00:00:01.000Z" },
              parts: [
                { type: "reasoning", text: "private reasoning" },
                { type: "text", text: "intermediate answer" },
              ],
            },
            {
              info: { role: "tool", time: "2026-01-01T00:00:02.000Z" },
              parts: [{ type: "tool_result", content: "raw tool output" }],
            },
            {
              info: { role: "assistant", time: "2026-01-01T00:00:03.000Z" },
              parts: [{ type: "text", text: "final answer" }],
            },
          ],
        }),
      },
    }

    const first = await formatTaskResult(createTask(), client)
    const second = await formatTaskResult(createTask(), client)

    expect(first).toContain("final answer")
    expect(first).not.toContain("intermediate answer")
    expect(first).not.toContain("private reasoning")
    expect(first).not.toContain("raw tool output")
    expect(second).toContain("No new output since last check")
  })

  test("falls back to the last tool text without exposing reasoning blocks", async () => {
    const client: BackgroundOutputClient = {
      session: {
        messages: async () => ({
          data: [
            {
              info: { role: "tool", time: "2026-01-01T00:00:01.000Z" },
              parts: [
                {
                  type: "tool_result",
                  content: [
                    { type: "reasoning", text: "private tool reasoning" },
                    { type: "text", text: "actionable tool result" },
                  ],
                },
              ],
            },
          ],
        }),
      },
    }

    const output = await formatTaskResult(createTask(), client)

    expect(output).toContain("actionable tool result")
    expect(output).not.toContain("private tool reasoning")
  })
})

import { describe, expect, test } from "bun:test"

import type { BackgroundTask } from "../../features/background-agent"
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

  test("leads with the final assistant answer before older context", async () => {
    // given a session with an intermediate step, a tool result, then a final answer
    const task = createTask({ sessionId: "ses-final-first" })
    const client: BackgroundOutputClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { role: "assistant", time: { created: 1 } }, parts: [{ type: "text", text: "OLDER_INTERMEDIATE_STEP" }] },
            { info: { role: "tool", time: { created: 2 } }, parts: [{ type: "tool_result", content: "TOOL_OUTPUT_DATA" }] },
            { info: { role: "assistant", time: { created: 3 } }, parts: [{ type: "text", text: "FINAL_ANSWER_HERE" }] },
          ],
        }),
      },
    }

    // when the result is formatted
    const output = await formatTaskResult(task, client)

    // then the final answer leads under its heading, before any older context
    expect(output).toContain("## Final answer")
    expect(output.indexOf("FINAL_ANSWER_HERE")).toBeGreaterThanOrEqual(0)
    expect(output.indexOf("FINAL_ANSWER_HERE")).toBeLessThan(output.indexOf("OLDER_INTERMEDIATE_STEP"))
    expect(output.indexOf("FINAL_ANSWER_HERE")).toBeLessThan(output.indexOf("TOOL_OUTPUT_DATA"))
    expect(output).toContain("Full detail available via `full_session:true`")
  })

  test("truncates an oversized tool_result block", async () => {
    // given a tool_result far larger than the cap
    const huge = "A".repeat(5000)
    const task = createTask({ sessionId: "ses-truncate" })
    const client: BackgroundOutputClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { role: "tool", time: { created: 1 } }, parts: [{ type: "tool_result", content: huge }] },
            { info: { role: "assistant", time: { created: 2 } }, parts: [{ type: "text", text: "done" }] },
          ],
        }),
      },
    }

    // when the result is formatted
    const output = await formatTaskResult(task, client)

    // then the tool_result is capped at TOOL_RESULT_MAX_CHARS with an ellipsis marker
    expect(output).not.toContain("A".repeat(2001))
    expect(output).toContain(`${"A".repeat(2000)}...`)
  })

  test("bounds total output for a huge fixture", async () => {
    // given a session with 100 sizeable messages plus a final answer
    const data = Array.from({ length: 100 }, (_, index) => ({
      info: { role: "tool" as const, time: { created: index } },
      parts: [{ type: "tool_result" as const, content: "C".repeat(1000) }],
    }))
    data.push({
      info: { role: "tool" as const, time: { created: 100 } },
      parts: [{ type: "tool_result" as const, content: "FINAL".repeat(1) }],
    })
    const task = createTask({ sessionId: "ses-bounded" })
    const client: BackgroundOutputClient = {
      session: {
        messages: async () => ({ data }),
      },
    }

    // when the result is formatted
    const output = await formatTaskResult(task, client)

    // then the trailing older-context section keeps the body bounded
    expect(output.length).toBeLessThan(40000)
  })

  test("returns the no-new-output notice when nothing is new since last check", async () => {
    // given the same messages consumed twice on one session
    const task = createTask({ sessionId: "ses-no-new" })
    const client: BackgroundOutputClient = {
      session: {
        messages: async () => ({
          data: [{ info: { role: "assistant", time: { created: 1 } }, parts: [{ type: "text", text: "first pass" }] }],
        }),
      },
    }

    // when formatted a first time then a second time
    await formatTaskResult(task, client)
    const output = await formatTaskResult(task, client)

    // then the second pass reports no new output
    expect(output).toContain("(No new output since last check)")
  })
})

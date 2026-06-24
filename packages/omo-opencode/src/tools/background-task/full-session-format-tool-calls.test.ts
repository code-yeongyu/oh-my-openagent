/// <reference types="bun-types" />

// Regression test: full-session output (used by background_output full_session /
// include_tool_results) used to drop tool_use/tool parts entirely, so callers saw
// tool RESULTS but never the tool CALLS or their arguments. The filter + renderer
// now include tool calls (gated on includeToolResults), mirroring session-formatter.

import { describe, expect, test } from "bun:test"
import type { BackgroundTask } from "../../features/background-agent"
import type { BackgroundOutputClient, BackgroundOutputMessagesResult } from "./clients"
import { formatFullSession } from "./full-session-format"

function makeTask(): BackgroundTask {
  return {
    id: "bg_test",
    description: "test task",
    status: "completed",
    sessionId: "ses_test",
  } as unknown as BackgroundTask
}

function makeClient(messages: BackgroundOutputMessagesResult): BackgroundOutputClient {
  return { session: { messages: async () => messages } }
}

const toolMessage: BackgroundOutputMessagesResult = {
  data: [
    {
      id: "m1",
      info: { role: "assistant" },
      parts: [
        { type: "tool", tool: "grep", input: { pattern: "needle", path: "src" } },
        { type: "tool_result", output: "found needle" },
      ],
    },
  ],
}

describe("formatFullSession tool-call rendering", () => {
  test("includeToolResults=true renders tool calls WITH their input arguments", async () => {
    const output = await formatFullSession(makeTask(), makeClient(toolMessage), {
      includeThinking: false,
      includeToolResults: true,
    })

    expect(output).toContain("[tool: grep]")
    expect(output).toContain("pattern")
    expect(output).toContain("needle")
    expect(output).toContain("[tool result] found needle")
  })

  test("includeToolResults=false omits tool calls and tool results", async () => {
    const output = await formatFullSession(makeTask(), makeClient(toolMessage), {
      includeThinking: false,
      includeToolResults: false,
    })

    expect(output).not.toContain("[tool: grep]")
    expect(output).not.toContain("[tool result]")
  })
})

import { describe, expect, it } from "bun:test"

import { projectTranscriptEntries } from "./entries"

describe("transcript entry projection", () => {
  it("#given an assistant trajectory #when projected #then canonical and contextual rows use stable ids", () => {
    // given
    const capturedAt = "2026-08-09T12:00:00.000Z"
    const longArgs = "x".repeat(301)

    // when
    const rows = projectTranscriptEntries(
      {
        kind: "assistant",
        messageId: "msg-1",
        textBlocks: ["first", "", "second"],
        reasoningBlocks: ["consider this", { redacted: true }],
        toolCalls: [
          {
            callId: "call-1",
            name: "read",
            argsText: longArgs,
            resultText: "done",
            resultOk: true,
          },
        ],
      },
      capturedAt,
    )

    // then
    expect(rows).toEqual([
      {
        kind: "assistant",
        text: "first\nsecond",
        captured_at: capturedAt,
        source_line_id: "msg-1:assistant",
        source_message_id: "msg-1",
      },
      {
        kind: "reasoning",
        text: "consider this",
        captured_at: capturedAt,
        source_line_id: "msg-1:reasoning:0",
        source_message_id: "msg-1",
      },
      {
        kind: "reasoning",
        text: "[REDACTED REASONING]",
        captured_at: capturedAt,
        source_line_id: "msg-1:reasoning:1",
        source_message_id: "msg-1",
      },
      {
        kind: "tool_call",
        name: "read",
        argsText: "x".repeat(300),
        resultText: "done",
        resultOk: true,
        captured_at: capturedAt,
        source_line_id: "msg-1:tool:call-1",
        source_message_id: "msg-1",
      },
    ])
  })

  it("#given a tool-only assistant message #when projected #then it has no canonical assistant row", () => {
    // given
    const message = {
      kind: "assistant" as const,
      messageId: "msg-tool-only",
      textBlocks: ["  "],
      toolCalls: [{ callId: "call-2", name: "bash" }],
    }

    // when
    const rows = projectTranscriptEntries(message, "2026-08-09T12:00:00.000Z")

    // then
    expect(rows.map((row) => row.kind)).toEqual(["tool_call"])
  })
})

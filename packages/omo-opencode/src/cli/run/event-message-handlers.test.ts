/// <reference path="../../../../../bun-test.d.ts" />
/// <reference types="bun-types" />
import { describe, expect, it, spyOn } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createEventState } from "./events"
import { handleMessagePartDelta, handleMessagePartUpdated, handleMessageUpdated } from "./event-handlers"
import { createMockContext, joinWriteCalls } from "./event-handler-test-support.test"

describe("handleMessagePartUpdated", () => {
  it("extracts sessionID from part", () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)

    const payload = {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part_1",
          sessionID: "ses_main",
          messageID: "msg_1",
          type: "text",
          text: "Hello world",
        },
      },
    }

    //#when
    handleMessagePartUpdated(ctx, unsafeTestValue(payload), state)

    //#then
    expect(state.hasReceivedMeaningfulWork).toBe(true)
    expect(state.mainSessionStarted).toBe(true)
    expect(state.lastPartText).toBe("Hello world")
    expect(stdoutSpy).toHaveBeenCalled()
    stdoutSpy.mockRestore()
  })

  it("skips events for different session", () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()

    const payload = {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part_1",
          sessionID: "ses_other",
          messageID: "msg_1",
          type: "text",
          text: "Hello world",
        },
      },
    }

    //#when
    handleMessagePartUpdated(ctx, unsafeTestValue(payload), state)

    //#then
    expect(state.hasReceivedMeaningfulWork).toBe(false)
    expect(state.lastPartText).toBe("")
  })

  it("handles tool part with running status", () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)

    const payload = {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part_1",
          sessionID: "ses_main",
          messageID: "msg_1",
          type: "tool",
          tool: "read",
          state: { status: "running", input: { filePath: "/src/index.ts" } },
        },
      },
    }

    //#when
    handleMessagePartUpdated(ctx, unsafeTestValue(payload), state)

    //#then
    expect(state.currentTool).toBe("read")
    expect(state.hasReceivedMeaningfulWork).toBe(true)
    expect(state.mainSessionStarted).toBe(true)
    stdoutSpy.mockRestore()
  })

  it("clears currentTool when tool completes", () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    state.currentTool = "read"
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)

    const payload = {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part_1",
          sessionID: "ses_main",
          messageID: "msg_1",
          type: "tool",
          tool: "read",
          state: { status: "completed", input: {}, output: "file contents here" },
        },
      },
    }

    //#when
    handleMessagePartUpdated(ctx, unsafeTestValue(payload), state)

    //#then
    expect(state.currentTool).toBeNull()
    stdoutSpy.mockRestore()
  })

  it("supports legacy info.sessionID", () => {
    //#given
    const ctx = createMockContext("ses_legacy")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)

    const payload = {
      type: "message.part.updated",
      properties: {
        info: { sessionID: "ses_legacy", role: "assistant" },
        part: {
          type: "text",
          text: "Legacy text",
        },
      },
    }

    //#when
    handleMessagePartUpdated(ctx, unsafeTestValue(payload), state)

    //#then
    expect(state.hasReceivedMeaningfulWork).toBe(true)
    expect(state.lastPartText).toBe("Legacy text")
    stdoutSpy.mockRestore()
  })

  it("does not reprint a text part snapshot after an interleaved tool result", () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)

    const partEvent = (part: Record<string, unknown>) =>
      unsafeTestValue({
        type: "message.part.updated",
        properties: { part: { sessionID: "ses_main", messageID: "msg_1", ...part } },
      })

    //#when
    handleMessagePartUpdated(ctx, partEvent({ id: "part_text", type: "text", text: "alpha\nbeta\n" }), state)
    handleMessagePartUpdated(
      ctx,
      partEvent({ id: "part_tool", type: "tool", tool: "read", state: { status: "running", input: {} } }),
      state,
    )
    handleMessagePartUpdated(
      ctx,
      partEvent({
        id: "part_tool",
        type: "tool",
        tool: "read",
        state: { status: "completed", input: {}, output: "file contents" },
      }),
      state,
    )
    handleMessagePartUpdated(
      ctx,
      partEvent({ id: "part_text", type: "text", text: "alpha\nbeta\ngamma\n", time: { end: 1 } }),
      state,
    )

    //#then
    const output = joinWriteCalls(stdoutSpy.mock.calls)
    expect(output.split("alpha").length - 1).toBe(1)
    expect(output.split("beta").length - 1).toBe(1)
    expect(output.split("gamma").length - 1).toBe(1)
    stdoutSpy.mockRestore()
  })

  it("renders a new text part whose snapshot is shorter than the previous part accumulator", () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)

    //#when
    handleMessagePartUpdated(
      ctx,
      unsafeTestValue({
        type: "message.part.updated",
        properties: {
          part: {
            id: "part_1",
            sessionID: "ses_main",
            messageID: "msg_1",
            type: "text",
            text: "A".repeat(64),
          },
        },
      }),
      state,
    )
    handleMessagePartUpdated(
      ctx,
      unsafeTestValue({
        type: "message.part.updated",
        properties: {
          part: {
            id: "part_2",
            sessionID: "ses_main",
            messageID: "msg_1",
            type: "text",
            text: "second part body",
          },
        },
      }),
      state,
    )

    //#then
    const output = joinWriteCalls(stdoutSpy.mock.calls)
    expect(output).toContain("second part body")
    stdoutSpy.mockRestore()
  })

  it("prints only the grown suffix when a text part snapshot extends its own previous text", () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)

    const textEvent = (text: string) =>
      unsafeTestValue({
        type: "message.part.updated",
        properties: {
          part: { id: "part_1", sessionID: "ses_main", messageID: "msg_1", type: "text", text },
        },
      })

    //#when
    handleMessagePartUpdated(ctx, textEvent("hello"), state)
    handleMessagePartUpdated(ctx, textEvent("hello world"), state)

    //#then
    const output = joinWriteCalls(stdoutSpy.mock.calls)
    expect(output.split("hello").length - 1).toBe(1)
    expect(output.split("world").length - 1).toBe(1)
    stdoutSpy.mockRestore()
  })

  it("does not duplicate text when deltas are followed by a full snapshot for the same part", () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)

    const deltaEvent = (delta: string) =>
      unsafeTestValue({
        type: "message.part.delta",
        properties: { sessionID: "ses_main", messageID: "msg_1", partID: "part_1", field: "text", delta },
      })
    const snapshotEvent = (text: string) =>
      unsafeTestValue({
        type: "message.part.updated",
        properties: {
          part: { id: "part_1", sessionID: "ses_main", messageID: "msg_1", type: "text", text },
        },
      })

    //#when
    handleMessagePartDelta(ctx, deltaEvent("Hel"), state)
    handleMessagePartDelta(ctx, deltaEvent("lo"), state)
    handleMessagePartUpdated(ctx, snapshotEvent("Hello"), state)

    //#then
    const output = joinWriteCalls(stdoutSpy.mock.calls)
    expect(output.split("Hello").length - 1).toBe(1)
    stdoutSpy.mockRestore()
  })

  it("prints completion metadata once when assistant text part is completed", () => {
    //#given
    const nowSpy = spyOn(Date, "now").mockReturnValue(3400)
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)

    handleMessageUpdated(
      ctx,
      unsafeTestValue({
        type: "message.updated",
        properties: {
          info: {
            id: "msg_1",
            sessionID: "ses_main",
            role: "assistant",
            agent: "Sisyphus",
            modelID: "claude-sonnet-4-6",
          },
        },
      }),
      state,
    )
    state.messageStartedAtById["msg_1"] = 1000

    //#when
    handleMessagePartUpdated(
      ctx,
      unsafeTestValue({
        type: "message.part.updated",
        properties: {
          part: {
            id: "part_1",
            sessionID: "ses_main",
            messageID: "msg_1",
            type: "text",
            text: "done",
            time: { end: 1 },
          },
        },
      }),
      state,
    )
    handleMessagePartUpdated(
      ctx,
      unsafeTestValue({
        type: "message.part.updated",
        properties: {
          part: {
            id: "part_1",
            sessionID: "ses_main",
            messageID: "msg_1",
            type: "text",
            text: "done",
            time: { end: 2 },
          },
        },
      }),
      state,
    )

    //#then
    const output = joinWriteCalls(stdoutSpy.mock.calls)
    const metaCount = output.split("Sisyphus · claude-sonnet-4-6 · 2.4s").length - 1
    expect(metaCount).toBe(1)
    expect(state.completionMetaPrintedByMessageId["msg_1"]).toBe(true)

    stdoutSpy.mockRestore()
    nowSpy.mockRestore()
  })
})

describe("handleMessageUpdated", () => {
  it("resets streamed text and reasoning state for a new assistant message", () => {
    //#given
    const nowSpy = spyOn(Date, "now").mockReturnValue(9000)
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    state.currentMessageId = "msg_old"
    state.lastPartText = "old text"
    state.lastReasoningText = "old reasoning"
    state.hasPrintedThinkingLine = true
    state.lastThinkingSummary = "old summary"
    state.textAtLineStart = false
    state.thinkingAtLineStart = true
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)

    const payload = {
      type: "message.updated",
      properties: {
        info: {
          id: "msg_new",
          sessionID: "ses_main",
          role: "assistant",
          agent: "Atlas",
          modelID: "gpt-5.2",
          variant: "low",
        },
      },
    }

    //#when
    handleMessageUpdated(ctx, unsafeTestValue(payload), state)

    //#then
    expect(state.currentMessageId).toBe("msg_new")
    expect(state.messageCount).toBe(1)
    expect(state.lastPartText).toBe("")
    expect(state.lastReasoningText).toBe("")
    expect(state.hasPrintedThinkingLine).toBe(false)
    expect(state.lastThinkingSummary).toBe("")
    expect(state.textAtLineStart).toBe(true)
    expect(state.thinkingAtLineStart).toBe(false)
    expect(state.messageStartedAtById["msg_new"]).toBe(9000)
    expect(state.completionMetaPrintedByMessageId["msg_new"]).toBe(false)

    stdoutSpy.mockRestore()
    nowSpy.mockRestore()
  })
})

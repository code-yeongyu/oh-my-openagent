/// <reference path="../../../../../bun-test.d.ts" />
/// <reference types="bun-types" />
import { describe, expect, it, spyOn } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createEventState } from "./events"
import { handleMessagePartUpdated, handleMessageUpdated } from "./event-handlers"
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

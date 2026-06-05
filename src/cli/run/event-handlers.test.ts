/// <reference path="../../../bun-test.d.ts" />
/// <reference types="bun-types" />
import { describe, expect, it, spyOn } from "bun:test"
import type { RunContext } from "./types"
import { createEventState } from "./events"
import {
  handleMessagePartUpdated,
  handleMessageUpdated,
  handleSessionError,
  handleSessionStatus,
  handleToolExecute,
  handleToolResult,
  handleTuiToast,
} from "./event-handlers"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"

const createMockContext = (sessionID: string = "test-session"): RunContext => ({
  sessionID,
} as RunContext)

function joinWriteCalls(calls: readonly (readonly unknown[])[]): string {
  return calls.map((call) => String(call[0] ?? "")).join("")
}

describe("handleSessionStatus", () => {
  it("recognizes idle from session.status event (not just deprecated session.idle)", () => {
    //#given - state with mainSessionIdle=false
    const ctx = createMockContext("test-session")
    const state = createEventState()
    state.mainSessionIdle = false

    const payload = {
      type: "session.status",
      properties: {
        sessionID: "test-session",
        status: { type: "idle" as const },
      },
    }

    //#when - handleSessionStatus called with idle status
    handleSessionStatus(ctx, unsafeTestValue(payload), state)

    //#then - state.mainSessionIdle === true
    expect(state.mainSessionIdle).toBe(true)
  })

  it("handleSessionStatus sets idle=false on busy", () => {
    //#given - state with mainSessionIdle=true
    const ctx = createMockContext("test-session")
    const state = createEventState()
    state.mainSessionIdle = true

    const payload = {
      type: "session.status",
      properties: {
        sessionID: "test-session",
        status: { type: "busy" as const },
      },
    }

    //#when - handleSessionStatus called with busy status
    handleSessionStatus(ctx, unsafeTestValue(payload), state)

    //#then - state.mainSessionIdle === false
    expect(state.mainSessionIdle).toBe(false)
    expect(state.mainSessionStarted).toBe(true)
  })

  it("does nothing for different session ID", () => {
    //#given - state with mainSessionIdle=true
    const ctx = createMockContext("test-session")
    const state = createEventState()
    state.mainSessionIdle = true

    const payload = {
      type: "session.status",
      properties: {
        sessionID: "other-session",
        status: { type: "idle" as const },
      },
    }

    //#when - handleSessionStatus called with different session ID
    handleSessionStatus(ctx, unsafeTestValue(payload), state)

    //#then - state.mainSessionIdle remains unchanged
    expect(state.mainSessionIdle).toBe(true)
  })

  it("recognizes idle from camelCase sessionId", () => {
    //#given - state with mainSessionIdle=false and payload using sessionId
    const ctx = createMockContext("test-session")
    const state = createEventState()
    state.mainSessionIdle = false

    const payload = {
      type: "session.status",
      properties: {
        sessionId: "test-session",
        status: { type: "idle" as const },
      },
    }

    //#when - handleSessionStatus called with camelCase sessionId
    handleSessionStatus(ctx, unsafeTestValue(payload), state)

    //#then - state.mainSessionIdle === true
    expect(state.mainSessionIdle).toBe(true)
  })
})

describe("handleSessionError", () => {
  it("records and prints matching session errors", () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const errorSpy = spyOn(console, "error").mockImplementation(() => {})

    const payload = {
      type: "session.error",
      properties: {
        sessionID: "ses_main",
        error: { message: "Provider timed out" },
      },
    }

    //#when
    handleSessionError(ctx, unsafeTestValue(payload), state)

    //#then
    expect(state.mainSessionError).toBe(true)
    expect(state.lastError).toBe("Provider timed out")
    expect(errorSpy).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })

  it("ignores errors from other sessions", () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    const errorSpy = spyOn(console, "error").mockImplementation(() => {})

    const payload = {
      type: "session.error",
      properties: {
        sessionID: "ses_other",
        error: { message: "Other session failed" },
      },
    }

    //#when
    handleSessionError(ctx, unsafeTestValue(payload), state)

    //#then
    expect(state.mainSessionError).toBe(false)
    expect(state.lastError).toBe(null)
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe("handleMessagePartUpdated", () => {
  it("extracts sessionID from part (current OpenCode event structure)", () => {
    //#given - message.part.updated with sessionID in part, not info
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
    //#given - message.part.updated with different session
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
    //#given - tool part in running state
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
    //#given - tool part in completed state
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

  it("supports legacy info.sessionID for backward compatibility", () => {
    //#given - legacy event with sessionID in info
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
    // given
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

    // when
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

    // then
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

describe("handleToolExecute and handleToolResult", () => {
  it("prints tool output and resets stream state when a running tool completes", () => {
    //#given
    const ctx = createMockContext("ses_main")
    const state = createEventState()
    state.lastPartText = "assistant text before tool"
    state.textAtLineStart = false
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)

    const executePayload = {
      type: "tool.execute",
      properties: {
        sessionID: "ses_main",
        name: "read_file",
        input: { filePath: "/src/index.ts" },
      },
    }
    const resultPayload = {
      type: "tool.result",
      properties: {
        sessionID: "ses_main",
        name: "read_file",
        output: "export const value = 1",
      },
    }

    //#when
    handleToolExecute(ctx, unsafeTestValue(executePayload), state)
    handleToolResult(ctx, unsafeTestValue(resultPayload), state)

    //#then
    const rendered = joinWriteCalls(stdoutSpy.mock.calls)
    expect(state.currentTool).toBe(null)
    expect(state.lastPartText).toBe("")
    expect(state.textAtLineStart).toBe(true)
    expect(rendered).toContain("read_file")
    expect(rendered).toContain("output")
    expect(rendered).toContain("export const value = 1")

    stdoutSpy.mockRestore()
  })
})

describe("handleTuiToast", () => {
  it("marks main session as error when toast variant is error", () => {
    //#given - toast error payload
    const ctx = createMockContext("test-session")
    const state = createEventState()

    const payload = {
      type: "tui.toast.show",
      properties: {
        title: "Auth",
        message: "Invalid API key",
        variant: "error" as const,
      },
    }

    //#when
    handleTuiToast(ctx, unsafeTestValue(payload), state)

    //#then
    expect(state.mainSessionError).toBe(true)
    expect(state.lastError).toBe("Auth: Invalid API key")
  })

  it("does not mark session error for warning toast", () => {
    //#given - toast warning payload
    const ctx = createMockContext("test-session")
    const state = createEventState()

    const payload = {
      type: "tui.toast.show",
      properties: {
        message: "Retrying provider",
        variant: "warning" as const,
      },
    }

    //#when
    handleTuiToast(ctx, unsafeTestValue(payload), state)

    //#then
    expect(state.mainSessionError).toBe(false)
    expect(state.lastError).toBe(null)
  })
})

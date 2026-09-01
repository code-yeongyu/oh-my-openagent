/// <reference path="../../../../../bun-test.d.ts" />
/// <reference types="bun-types" />
import { describe, expect, it, spyOn } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createEventState } from "./events"
import { handleToolExecute, handleToolResult } from "./event-handlers"
import { createMockContext, joinWriteCalls } from "./event-handler-test-support.test"

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

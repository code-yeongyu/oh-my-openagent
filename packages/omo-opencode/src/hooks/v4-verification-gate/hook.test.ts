/// <reference types="bun-types" />

import { describe, expect, test, mock, afterAll } from "bun:test"

const logMock = mock(() => {})

mock.module("../../shared/logger", () => ({
  log: logMock,
}))

afterAll(() => {
  mock.restore()
})

const { createV4VerificationGateHook } = await import("./hook")

describe("v4-verification-gate", () => {
  test("#given V4 model session and task tool completion #when tool.execute.after runs #then appends verification reminder", () => {
    // given
    const hook = createV4VerificationGateHook()
    const sessionID = "ses_v4"

    // simulate message.updated with V4 model
    hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            sessionID,
            modelID: "deepseek/deepseek-v4-pro",
            role: "assistant",
          },
        },
      },
    })

    // when
    const output = { title: "", output: "Task completed successfully.", metadata: null }
    hook["tool.execute.after"](
      { tool: "task", sessionID, callID: "call_1" },
      output,
    )

    // then
    expect(output.output).toContain("V4 VERIFICATION REQUIRED")
    expect(output.output).toContain("94% hallucination rate")
  })

  test("#given V4 model session and call_omo_agent tool completion #when tool.execute.after runs #then appends verification reminder", () => {
    // given
    const hook = createV4VerificationGateHook()
    const sessionID = "ses_v4_agent"

    hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            sessionID,
            modelID: "deepseek/deepseek-v4-flash",
            role: "assistant",
          },
        },
      },
    })

    // when
    const output = { title: "", output: "Agent result.", metadata: null }
    hook["tool.execute.after"](
      { tool: "call_omo_agent", sessionID, callID: "call_2" },
      output,
    )

    // then
    expect(output.output).toContain("V4 VERIFICATION REQUIRED")
  })

  test("#given non-V4 model session and task tool completion #when tool.execute.after runs #then does NOT append reminder", () => {
    // given
    const hook = createV4VerificationGateHook()
    const sessionID = "ses_non_v4"

    hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            sessionID,
            modelID: "anthropic/claude-sonnet-4-6",
            role: "assistant",
          },
        },
      },
    })

    // when
    const output = { title: "", output: "Task completed.", metadata: null }
    hook["tool.execute.after"](
      { tool: "task", sessionID, callID: "call_3" },
      output,
    )

    // then
    expect(output.output).toBe("Task completed.")
  })

  test("#given V4 model session and non-delegation tool #when tool.execute.after runs #then does NOT append reminder", () => {
    // given
    const hook = createV4VerificationGateHook()
    const sessionID = "ses_v4_other"

    hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            sessionID,
            modelID: "deepseek/deepseek-v4-pro",
            role: "assistant",
          },
        },
      },
    })

    // when
    const output = { title: "", output: "Read result.", metadata: null }
    hook["tool.execute.after"](
      { tool: "read", sessionID, callID: "call_4" },
      output,
    )

    // then
    expect(output.output).toBe("Read result.")
  })

  test("#given no cached model for session #when tool.execute.after runs #then does NOT append reminder", () => {
    // given
    const hook = createV4VerificationGateHook()

    // when — no event received for this session
    const output = { title: "", output: "Task result.", metadata: null }
    hook["tool.execute.after"](
      { tool: "task", sessionID: "ses_unknown", callID: "call_5" },
      output,
    )

    // then
    expect(output.output).toBe("Task result.")
  })
})

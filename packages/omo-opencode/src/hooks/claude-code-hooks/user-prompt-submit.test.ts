import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"
import * as dispatchHookModule from "./dispatch-hook"
import {
  executeUserPromptSubmitHooks,
  type UserPromptSubmitContext,
} from "./user-prompt-submit"

describe("executeUserPromptSubmitHooks", () => {
  afterEach(() => {
    mock.restore()
  })

  it("returns early when no config provided", async () => {
    // given
    const ctx: UserPromptSubmitContext = {
      sessionId: "test-session",
      prompt: "test prompt",
      parts: [{ type: "text", text: "test prompt" }],
      cwd: "/tmp",
    }

    // when
    const result = await executeUserPromptSubmitHooks(ctx, null)

    // then
    expect(result.block).toBe(false)
    expect(result.messages).toEqual([])
  })

  it("returns early when hook tags present in user input", async () => {
    // given
    const ctx: UserPromptSubmitContext = {
      sessionId: "test-session",
      prompt: "<user-prompt-submit-hook>previous output</user-prompt-submit-hook>",
      parts: [
        {
          type: "text",
          text: "<user-prompt-submit-hook>previous output</user-prompt-submit-hook>",
        },
      ],
      cwd: "/tmp",
    }

    // when
    const result = await executeUserPromptSubmitHooks(ctx, null)

    // then
    expect(result.block).toBe(false)
    expect(result.messages).toEqual([])
  })

  it("does not return early when hook tags in prompt but not in user input", async () => {
    // given - simulates case where hook output was injected into session context
    // but current user input does not contain tags
    const ctx: UserPromptSubmitContext = {
      sessionId: "test-session",
      prompt:
        "<user-prompt-submit-hook>previous output</user-prompt-submit-hook>\n\nuser message",
      parts: [{ type: "text", text: "user message" }],
      cwd: "/tmp",
    }

    // when
    const result = await executeUserPromptSubmitHooks(ctx, null)

    // then - should not return early, should continue to config check
    expect(result.block).toBe(false)
    expect(result.messages).toEqual([])
  })

  it("should fire on first prompt", async () => {
    // given
    const ctx: UserPromptSubmitContext = {
      sessionId: "test-session-1",
      prompt: "first prompt",
      parts: [{ type: "text", text: "first prompt" }],
      cwd: "/tmp",
    }

    // when
    const result = await executeUserPromptSubmitHooks(ctx, null)

    // then
    expect(result.block).toBe(false)
    expect(result.messages).toEqual([])
  })

  it("should fire on second prompt in same session", async () => {
    // given
    const ctx1: UserPromptSubmitContext = {
      sessionId: "test-session-2",
      prompt: "first prompt",
      parts: [{ type: "text", text: "first prompt" }],
      cwd: "/tmp",
    }

    const ctx2: UserPromptSubmitContext = {
      sessionId: "test-session-2",
      prompt: "second prompt",
      parts: [{ type: "text", text: "second prompt" }],
      cwd: "/tmp",
    }

    // when
    const result1 = await executeUserPromptSubmitHooks(ctx1, null)
    const result2 = await executeUserPromptSubmitHooks(ctx2, null)

    // then
    expect(result1.block).toBe(false)
    expect(result2.block).toBe(false)
  })

  it("#given synthetic hook context only #when prompt submit runs #then hook command is not dispatched", async () => {
    // given
    const dispatchSpy = spyOn(dispatchHookModule, "dispatchHook").mockResolvedValue({
      exitCode: 0,
      stdout: "hook output",
      stderr: "",
    })
    const ctx: UserPromptSubmitContext = {
      sessionId: "test-session-synthetic",
      prompt: "synthetic hook message",
      parts: [{ type: "text", text: "synthetic hook message", synthetic: true }],
      cwd: "/tmp",
    }
    const config = {
      UserPromptSubmit: [
        { matcher: "*", hooks: [{ type: "command" as const, command: "echo hook" }] },
      ],
    }

    // when
    const result = await executeUserPromptSubmitHooks(ctx, config)

    // then
    expect(result.block).toBe(false)
    expect(result.messages).toEqual([])
    expect(dispatchSpy).toHaveBeenCalledTimes(0)
  })

  it("#given hook stdout with CRLF and bare CR #when prompt submit runs #then injected hook context is normalized", async () => {
    // given
    spyOn(dispatchHookModule, "dispatchHook").mockResolvedValue({
      exitCode: 0,
      stdout: "\r\nfirst line\r\n  second line\rthird line\r\n",
      stderr: "",
    })
    const ctx: UserPromptSubmitContext = {
      sessionId: "test-session-newlines",
      prompt: "hello",
      parts: [{ type: "text", text: "hello" }],
      cwd: "/tmp",
    }
    const config = {
      UserPromptSubmit: [
        { matcher: "*", hooks: [{ type: "command" as const, command: "echo hook" }] },
      ],
    }

    // when
    const result = await executeUserPromptSubmitHooks(ctx, config)

    // then
    expect(result.messages).toEqual([
      "<user-prompt-submit-hook>\nfirst line\n  second line\nthird line\n</user-prompt-submit-hook>",
    ])
  })

  it("#given internal prompt marker only #when prompt submit runs #then hook command is not dispatched", async () => {
    // given
    const dispatchSpy = spyOn(dispatchHookModule, "dispatchHook").mockResolvedValue({
      exitCode: 0,
      stdout: "hook output",
      stderr: "",
    })
    const ctx: UserPromptSubmitContext = {
      sessionId: "test-session-internal",
      prompt: `internal hook message\n${OMO_INTERNAL_INITIATOR_MARKER}`,
      parts: [
        {
          type: "text",
          text: `internal hook message\n${OMO_INTERNAL_INITIATOR_MARKER}`,
        },
      ],
      cwd: "/tmp",
    }
    const config = {
      UserPromptSubmit: [
        { matcher: "*", hooks: [{ type: "command" as const, command: "echo hook" }] },
      ],
    }

    // when
    const result = await executeUserPromptSubmitHooks(ctx, config)

    // then
    expect(result.block).toBe(false)
    expect(result.messages).toEqual([])
    expect(dispatchSpy).toHaveBeenCalledTimes(0)
  })
})

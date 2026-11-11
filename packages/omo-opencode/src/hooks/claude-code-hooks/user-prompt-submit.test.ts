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

describe("executeUserPromptSubmitHooks control output", () => {
  afterEach(() => {
    mock.restore()
  })

  const ctx: UserPromptSubmitContext = {
    sessionId: "test-session-control",
    prompt: "hello",
    parts: [{ type: "text", text: "hello" }],
    cwd: "/tmp",
  }

  const config = {
    UserPromptSubmit: [
      { matcher: "*", hooks: [{ type: "command" as const, command: "echo hook" }] },
    ],
  }

  function mockHook(stdout?: string, options?: { exitCode?: number; stderr?: string }) {
    spyOn(dispatchHookModule, "dispatchHook").mockResolvedValue({
      exitCode: options?.exitCode ?? 0,
      stdout,
      stderr: options?.stderr ?? "",
    })
  }

  it("#given a hook that writes nothing #when prompt submit runs #then nothing is injected", async () => {
    // given
    mockHook()

    // when
    const result = await executeUserPromptSubmitHooks(ctx, config)

    // then
    expect(result.block).toBe(false)
    expect(result.messages).toEqual([])
  })

  it("#given control output without additionalContext #when prompt submit runs #then nothing is injected", async () => {
    // given
    mockHook('{"continue":true}')

    // when
    const result = await executeUserPromptSubmitHooks(ctx, config)

    // then
    expect(result.block).toBe(false)
    expect(result.messages).toEqual([])
  })

  it("#given control output with additionalContext #when prompt submit runs #then only that context is injected", async () => {
    // given
    mockHook(
      JSON.stringify({
        continue: true,
        systemMessage: "shown to the user, not to the model",
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: "branch is main",
        },
      })
    )

    // when
    const result = await executeUserPromptSubmitHooks(ctx, config)

    // then
    expect(result.messages).toEqual([
      "<user-prompt-submit-hook>\nbranch is main\n</user-prompt-submit-hook>",
    ])
  })

  it("#given text containing a brace #when prompt submit runs #then it is injected verbatim", async () => {
    // given - only stdout that starts with `{` is control output
    mockHook("warning: {count} placeholders left")

    // when
    const result = await executeUserPromptSubmitHooks(ctx, config)

    // then
    expect(result.messages).toEqual([
      "<user-prompt-submit-hook>\nwarning: {count} placeholders left\n</user-prompt-submit-hook>",
    ])
  })

  it("#given malformed JSON #when prompt submit runs #then it is injected verbatim", async () => {
    // given
    mockHook('{"continue": tru')

    // when
    const result = await executeUserPromptSubmitHooks(ctx, config)

    // then
    expect(result.messages).toEqual([
      '<user-prompt-submit-hook>\n{"continue": tru\n</user-prompt-submit-hook>',
    ])
  })

  it("#given decision block on exit 0 #when prompt submit runs #then the prompt is blocked", async () => {
    // given
    mockHook('{"decision":"block","reason":"secrets in prompt"}')

    // when
    const result = await executeUserPromptSubmitHooks(ctx, config)

    // then
    expect(result.block).toBe(true)
    expect(result.reason).toBe("secrets in prompt")
    expect(result.messages).toEqual([])
  })

  it("#given continue false #when prompt submit runs #then the prompt is blocked with stopReason", async () => {
    // given
    mockHook('{"continue":false,"stopReason":"quota exhausted"}')

    // when
    const result = await executeUserPromptSubmitHooks(ctx, config)

    // then
    expect(result.block).toBe(true)
    expect(result.reason).toBe("quota exhausted")
  })

  it("#given valid JSON that is not an object #when prompt submit runs #then it is injected verbatim", async () => {
    // given - the leading `{` is what marks control output, not JSON validity
    mockHook('[{"note":"first"}]')

    // when
    const result = await executeUserPromptSubmitHooks(ctx, config)

    // then
    expect(result.messages).toEqual([
      '<user-prompt-submit-hook>\n[{"note":"first"}]\n</user-prompt-submit-hook>',
    ])
  })

  it("#given both decision block and continue false #when prompt submit runs #then reason wins over stopReason", async () => {
    // given
    mockHook('{"decision":"block","reason":"blocked","continue":false,"stopReason":"stopped"}')

    // when
    const result = await executeUserPromptSubmitHooks(ctx, config)

    // then
    expect(result.block).toBe(true)
    expect(result.reason).toBe("blocked")
  })

  it("#given continue false without stopReason #when prompt submit runs #then stderr becomes the reason", async () => {
    // given
    mockHook('{"continue":false}', { exitCode: 1, stderr: "hook failed" })

    // when
    const result = await executeUserPromptSubmitHooks(ctx, config)

    // then
    expect(result.block).toBe(true)
    expect(result.reason).toBe("hook failed")
  })
})

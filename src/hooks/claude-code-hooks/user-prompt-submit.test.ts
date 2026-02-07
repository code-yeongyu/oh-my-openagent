import { describe, it, expect } from "bun:test"
import {
  executeUserPromptSubmitHooks,
  type UserPromptSubmitContext,
} from "./user-prompt-submit"

describe("executeUserPromptSubmitHooks", () => {
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
})

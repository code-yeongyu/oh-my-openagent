import { beforeEach, describe, expect, it } from "bun:test"

const { clearThinkModeState, createThinkModeHook } = await import("./index")

type ThinkModeHookInput = {
  sessionID: string
  model?: { providerID: string; modelID: string }
}

type ThinkModeHookOutput = {
  message: Record<string, unknown>
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
}

function createHookInput(args: {
  sessionID?: string
  providerID?: string
  modelID?: string
}): ThinkModeHookInput {
  const { sessionID = "test-session-id", providerID, modelID } = args

  if (!providerID || !modelID) {
    return { sessionID }
  }

  return {
    sessionID,
    model: { providerID, modelID },
  }
}

function createHookOutput(promptText: string, variant?: string): ThinkModeHookOutput {
  return {
    message: variant ? { variant } : {},
    parts: [{ type: "text", text: promptText }],
  }
}

describe("createThinkModeHook", () => {
  const sessionID = "test-session-id"

  beforeEach(() => {
    clearThinkModeState(sessionID)
  })

  it("sets high variant and switches model when think keyword is present", async () => {
    // given
    const hook = createThinkModeHook()
    const input = createHookInput({
      sessionID,
      providerID: "github-copilot",
      modelID: "claude-opus-4-6",
    })
    const output = createHookOutput("Please think deeply about this")

    // when
    await hook["chat.message"](input, output)

    // then
    expect(output.message.variant).toBe("high")
    expect(output.message.model).toEqual({
      providerID: "github-copilot",
      modelID: "claude-opus-4-6-high",
    })
  })

  it("supports dotted model IDs by switching to normalized high variant", async () => {
    // given
    const hook = createThinkModeHook()
    const input = createHookInput({
      sessionID,
      providerID: "github-copilot",
      modelID: "gpt-5.4",
    })
    const output = createHookOutput("ultrathink about this")

    // when
    await hook["chat.message"](input, output)

    // then
    expect(output.message.variant).toBe("high")
    expect(output.message.model).toEqual({
      providerID: "github-copilot",
      modelID: "gpt-5-4-high",
    })
  })

  it("skips when message variant is already set", async () => {
    // given
    const hook = createThinkModeHook()
    const input = createHookInput({
      sessionID,
      providerID: "github-copilot",
      modelID: "claude-sonnet-4-6",
    })
    const output = createHookOutput("think through this", "max")

    // when
    await hook["chat.message"](input, output)

    // then
    expect(output.message.variant).toBe("max")
    expect(output.message.model).toBeUndefined()
  })

  it("does nothing when think keyword is absent", async () => {
    // given
    const hook = createThinkModeHook()
    const input = createHookInput({
      sessionID,
      providerID: "google",
      modelID: "gemini-3.1-pro",
    })
    const output = createHookOutput("Please solve this directly")

    // when
    await hook["chat.message"](input, output)

    // then
    expect(output.message.variant).toBeUndefined()
    expect(output.message.model).toBeUndefined()
  })

  it("does not modify already-high models", async () => {
    // given
    const hook = createThinkModeHook()
    const input = createHookInput({
      sessionID,
      providerID: "openai",
      modelID: "gpt-5-high",
    })
    const output = createHookOutput("think deeply")

    // when
    await hook["chat.message"](input, output)

    // then
    expect(output.message.variant).toBeUndefined()
    expect(output.message.model).toBeUndefined()
  })

  it("handles missing input model without crashing", async () => {
    // given
    const hook = createThinkModeHook()
    const input = createHookInput({ sessionID })
    const output = createHookOutput("think about this")

    // when
    await expect(hook["chat.message"](input, output)).resolves.toBeUndefined()

    // then
    expect(output.message.variant).toBeUndefined()
    expect(output.message.model).toBeUndefined()
  })
})

describe("think-mode: regression tests for issue #2382", () => {
  const sessionID = "regression-2382"

  beforeEach(() => {
    clearThinkModeState(sessionID)
  })

  it("does NOT activate think mode for conversational Korean '고민' (to worry/ponder)", async () => {
    // given — a real user sentence that triggered the bug:
    // "너와 인공지능 엔진에게 이미지와 참조 자료를 어떻게 전달할지 고민하고 있었는데"
    const hook = createThinkModeHook()
    const input = createHookInput({
      sessionID,
      providerID: "opencode",
      modelID: "gpt-5-nano",
    })
    const output = createHookOutput(
      "너와 인공지능 엔진에게 이미지와 참조 자료를 어떻게 전달할지 고민하고 있었는데"
    )

    // when
    await hook["chat.message"](input, output)

    // then — model must NOT be upgraded; '고민' is conversational, not a reasoning directive
    expect(output.message.variant).toBeUndefined()
    expect(output.message.model).toBeUndefined()
  })

  it("does NOT upgrade gpt-5-nano even when think keyword IS present", async () => {
    // given — gpt-5-nano has no -high variant on Zen; upgrading it causes Model not found
    const hook = createThinkModeHook()
    const input = createHookInput({
      sessionID,
      providerID: "opencode",
      modelID: "gpt-5-nano",
    })
    const output = createHookOutput("신중하게 검토해줘")

    // when
    await hook["chat.message"](input, output)

    // then — no high variant exists for gpt-5-nano, so model stays unchanged
    expect(output.message.model).toBeUndefined()
  })

  it("still activates think mode for explicit Korean reasoning directive '생각해줘'", async () => {
    // given — explicit reasoning request should still trigger think mode on capable models
    const hook = createThinkModeHook()
    const input = createHookInput({
      sessionID,
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
    })
    const output = createHookOutput("이 문제 깊이 생각해줘")

    // when
    await hook["chat.message"](input, output)

    // then — explicit directive on a capable model should still upgrade
    expect(output.message.variant).toBe("high")
    expect(output.message.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-6-high",
    })
  })
})

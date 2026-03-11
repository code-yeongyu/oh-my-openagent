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

  it("sets high variant when think keyword is present", async () => {
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
    expect(output.message.model).toBeUndefined()
  })

  it("sets high variant for dotted model IDs", async () => {
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
    expect(output.message.model).toBeUndefined()
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

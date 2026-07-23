import { describe, expect, mock, test } from "bun:test"
import { handleGoalMessage } from "./loop-commands"
import type { ChatMessageHooks, ChatMessageHandlerOutput, ChatMessageInput } from "./types"

function createParts(text: string): ChatMessageHandlerOutput["parts"] {
  return [{ type: "text", text }]
}

describe("handleGoalMessage", () => {
  test("#given ordinary user prompt #when handleGoalMessage runs #then does not set goal", () => {
    // given
    const setGoal = mock(() => {})
    const hooks = {
      goal: {
        setGoal,
        pauseGoal: mock(() => {}),
        resumeGoal: mock(() => {}),
        clearGoal: mock(() => {}),
      },
    } as unknown as ChatMessageHooks
    const input = { sessionID: "ses_1" } as ChatMessageInput
    const output = {
      parts: createParts("please fix the flaky login test"),
      message: {},
    } as ChatMessageHandlerOutput

    // when
    handleGoalMessage({
      hooks,
      input,
      output,
      isFirstMessage: false,
      pluginConfig: {},
    })

    // then
    expect(setGoal).not.toHaveBeenCalled()
  })

  test("#given /goal command #when handleGoalMessage runs #then sets objective from args", () => {
    // given
    const setGoal = mock(() => {})
    const hooks = {
      goal: {
        setGoal,
        pauseGoal: mock(() => {}),
        resumeGoal: mock(() => {}),
        clearGoal: mock(() => {}),
      },
    } as unknown as ChatMessageHooks
    const input = { sessionID: "ses_1" } as ChatMessageInput
    const output = {
      parts: createParts("/goal ship the release"),
      message: {},
    } as ChatMessageHandlerOutput

    // when
    handleGoalMessage({
      hooks,
      input,
      output,
      isFirstMessage: false,
      pluginConfig: {},
    })

    // then
    expect(setGoal).toHaveBeenCalledWith("ses_1", "ship the release")
  })

  test("#given first message with default_mode.goal #when handleGoalMessage runs #then auto-starts goal", () => {
    // given
    const setGoal = mock(() => {})
    const hooks = {
      goal: {
        setGoal,
        pauseGoal: mock(() => {}),
        resumeGoal: mock(() => {}),
        clearGoal: mock(() => {}),
      },
    } as unknown as ChatMessageHooks
    const input = { sessionID: "ses_1" } as ChatMessageInput
    const output = {
      parts: createParts("build the dashboard"),
      message: {},
    } as ChatMessageHandlerOutput

    // when
    handleGoalMessage({
      hooks,
      input,
      output,
      isFirstMessage: true,
      pluginConfig: { default_mode: { goal: true } },
    })

    // then
    expect(setGoal).toHaveBeenCalledWith("ses_1", "build the dashboard")
  })

  test("#given long ordinary prompt #when handleGoalMessage runs #then does not set goal", () => {
    // given
    const setGoal = mock(() => {})
    const hooks = {
      goal: {
        setGoal,
        pauseGoal: mock(() => {}),
        resumeGoal: mock(() => {}),
        clearGoal: mock(() => {}),
      },
    } as unknown as ChatMessageHooks
    const input = { sessionID: "ses_1" } as ChatMessageInput
    const longPrompt = "x".repeat(2500)
    const output = {
      parts: createParts(longPrompt),
      message: {},
    } as ChatMessageHandlerOutput

    // when
    handleGoalMessage({
      hooks,
      input,
      output,
      isFirstMessage: false,
      pluginConfig: {},
    })

    // then
    expect(setGoal).not.toHaveBeenCalled()
  })
})

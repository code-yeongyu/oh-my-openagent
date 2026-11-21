import { afterEach, describe, expect, test } from "bun:test"

import { lowerReasoningForModel } from "../../shared/agent-variant"
import { clearSessionPromptParams, getSessionPromptParams } from "../../shared/session-prompt-params-state"
import type { ChatMessageHandlerOutput, ChatMessageInput } from "../../plugin/chat-message"
import { applyFallbackToChatMessage } from "./chat-message-fallback-handler"

const sessionID = "ses_fallback_reasoning"

afterEach(() => {
  clearSessionPromptParams(sessionID)
})

function chatMessage(variant?: string): { input: ChatMessageInput; output: ChatMessageHandlerOutput } {
  return {
    input: { sessionID } as ChatMessageInput,
    output: { message: variant === undefined ? {} : { variant }, parts: [] } as unknown as ChatMessageHandlerOutput,
  }
}

describe("applyFallbackToChatMessage rung reasoning (#9918)", () => {
  test("#given a rung with reasoning #when the fallback is applied #then the message and prompt params carry that rung's lowered reasoning", async () => {
    // given
    const { input, output } = chatMessage("low")
    const fallback = { providerID: "zai-coding-plan", modelID: "glm-5.3-flash", reasoning: "max" }

    // when
    await applyFallbackToChatMessage({ input, output, fallback, lastToastKey: new Map() })

    // then
    const lowered = lowerReasoningForModel("max", { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" })
    expect(output.message["variant"]).toBe(lowered.variant)
    expect(getSessionPromptParams(sessionID)?.options?.["reasoningEffort"]).toBe(lowered.reasoningEffort)
  })

  test("#given a rung with only a variant #when the fallback is applied #then the variant is written and prompt params are untouched", async () => {
    // given
    const { input, output } = chatMessage()

    // when
    await applyFallbackToChatMessage({
      input,
      output,
      fallback: { providerID: "provider-a", modelID: "model-a", variant: "high" },
      lastToastKey: new Map(),
    })

    // then
    expect(output.message["variant"]).toBe("high")
    expect(getSessionPromptParams(sessionID)).toBeUndefined()
  })
})

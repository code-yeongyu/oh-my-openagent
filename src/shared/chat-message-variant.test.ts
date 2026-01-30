import { describe, expect, test } from "bun:test"
import { createFirstMessageVariantGate } from "./first-message-variant"
import { applyChatMessageVariant } from "./chat-message-variant"

describe("applyChatMessageVariant", () => {
  test("respects input.variant even on the first message", () => {
    // #given
    const gate = createFirstMessageVariantGate()
    gate.markSessionCreated({ id: "session-1" })

    const message: { variant?: string } = {}

    // #when
    applyChatMessageVariant(
      {},
      gate,
      {
        sessionID: "session-1",
        agent: "sisyphus",
        model: { providerID: "openai", modelID: "gpt-5.2" },
        variant: "xhigh",
      },
      message
    )

    // #then
    expect(message.variant).toBe("xhigh")
    expect(gate.shouldOverride("session-1")).toBe(false)
  })

  test("applies agent/provider fallback on first message when no input.variant", () => {
    // #given
    const gate = createFirstMessageVariantGate()
    gate.markSessionCreated({ id: "session-1" })

    const message: { variant?: string } = {}

    // #when
    applyChatMessageVariant(
      {},
      gate,
      {
        sessionID: "session-1",
        agent: "sisyphus",
        model: { providerID: "openai", modelID: "gpt-5.2" },
      },
      message
    )

    // #then
    expect(message.variant).toBe("medium")
  })

  test("does not override an already-set message.variant on first message", () => {
    // #given
    const gate = createFirstMessageVariantGate()
    gate.markSessionCreated({ id: "session-1" })
    const message: { variant?: string } = { variant: "xhigh" }

    // #when
    applyChatMessageVariant(
      {},
      gate,
      {
        sessionID: "session-1",
        agent: "sisyphus",
        model: { providerID: "openai", modelID: "gpt-5.2" },
      },
      message
    )

    // #then
    expect(message.variant).toBe("xhigh")
  })
})

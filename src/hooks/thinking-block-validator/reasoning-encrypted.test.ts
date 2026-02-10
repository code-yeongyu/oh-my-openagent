import { describe, expect, it } from "bun:test"
import { createThinkingBlockValidatorHook } from "./hook"

describe("reasoning.encrypted in thinking-block-validator", () => {
  const hook = createThinkingBlockValidatorHook()
  const transform = hook["experimental.chat.messages.transform"]!

  function makeMessages(msgs: Array<{ role: string; parts: Array<Record<string, unknown>>; modelID?: string }>) {
    return msgs.map((m, i) => ({
      info: { id: `msg_${i}`, role: m.role, modelID: m.modelID } as Record<string, unknown>,
      parts: m.parts.map((p, j) => ({ id: `prt_${i}_${j}`, sessionID: "ses_test", messageID: `msg_${i}`, ...p })),
    }))
  }

  it("should not prepend thinking when message starts with reasoning.encrypted", async () => {
    //#given an assistant message that starts with a reasoning.encrypted block
    const messages = makeMessages([
      { role: "user", parts: [{ type: "text", text: "test" }], modelID: "claude-opus-4" },
      { role: "assistant", parts: [
        { type: "reasoning.encrypted", text: "encrypted reasoning" },
        { type: "text", text: "response" },
      ]},
    ])

    //#when the hook processes the messages
    const output = { messages }
    await transform({} as Record<string, never>, output)

    //#then no synthetic thinking block should be prepended
    const assistantParts = output.messages[1].parts
    expect(assistantParts[0].type).toBe("reasoning.encrypted")
    expect(assistantParts).toHaveLength(2)
  })

  it("should find previous reasoning.encrypted content for messages missing thinking", async () => {
    //#given a previous message with reasoning.encrypted and a current message without thinking
    const messages = makeMessages([
      { role: "user", parts: [{ type: "text", text: "test" }], modelID: "claude-opus-4" },
      { role: "assistant", parts: [
        { type: "reasoning.encrypted", text: "previous encrypted reasoning" },
        { type: "text", text: "first response" },
      ]},
      { role: "user", parts: [{ type: "text", text: "follow up" }], modelID: "claude-opus-4" },
      { role: "assistant", parts: [
        { type: "tool_use", name: "bash" },
      ]},
    ])

    //#when the hook processes the messages
    const output = { messages }
    await transform({} as Record<string, never>, output)

    //#then the second assistant message should have a prepended thinking block with previous reasoning content
    const secondAssistantParts = output.messages[3].parts
    expect(secondAssistantParts[0].type).toBe("thinking")
    expect((secondAssistantParts[0] as Record<string, unknown>).thinking).toBe("previous encrypted reasoning")
  })
})

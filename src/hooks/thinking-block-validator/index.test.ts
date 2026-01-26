import { describe, it, expect } from "bun:test"
import { createThinkingBlockValidatorHook } from "./index"

describe("thinking-block-validator", () => {
  describe("createThinkingBlockValidatorHook", () => {
    it("#then should return hook object with experimental.chat.messages.transform", () => {
      // #given
      const hook = createThinkingBlockValidatorHook()

      // #then
      expect(hook).toBeDefined()
      expect(hook["experimental.chat.messages.transform"]).toBeDefined()
      expect(typeof hook["experimental.chat.messages.transform"]).toBe("function")
    })
  })

  describe("experimental.chat.messages.transform", () => {
    it("#then should handle empty messages array", async () => {
      // #given
      const hook = createThinkingBlockValidatorHook()
      const output = { messages: [] }

      // #when
      await hook["experimental.chat.messages.transform"]!({} as never, output as any)

      // #then - should not throw
      expect(output.messages).toEqual([])
    })

    it("#then should not modify messages for non-extended-thinking models", async () => {
      // #given
      const hook = createThinkingBlockValidatorHook()
      const messages = [
        { info: { id: "msg-1", role: "user", modelID: "gpt-4" }, parts: [] },
        { info: { id: "msg-2", role: "assistant" }, parts: [{ type: "tool", id: "tool-1" }] },
      ]
      const output = { messages }

      // #when
      await hook["experimental.chat.messages.transform"]!({} as never, output as any)

      // #then - assistant message should not have thinking block prepended
      const assistantMsg = output.messages.find(m => m.info.role === "assistant")
      expect(assistantMsg?.parts.length).toBe(1)
      expect(assistantMsg?.parts[0].type).toBe("tool")
    })

    it("#then should prepend thinking block for extended-thinking model assistant messages", async () => {
      // #given
      const hook = createThinkingBlockValidatorHook()
      const messages = [
        { info: { id: "msg-1", role: "user", modelID: "claude-sonnet-4-thinking" }, parts: [{ type: "text", text: "Hello" }] },
        { info: { id: "msg-2", role: "assistant" }, parts: [{ type: "tool", id: "tool-1" }] },
      ]
      const output = { messages }

      // #when
      await hook["experimental.chat.messages.transform"]!({} as never, output as any)

      // #then - assistant message should have thinking block prepended
      const assistantMsg = output.messages.find(m => m.info.role === "assistant")
      expect(assistantMsg?.parts.length).toBe(2)
      expect(assistantMsg?.parts[0].type).toBe("thinking")
    })

    it("#then should not prepend thinking block if already present", async () => {
      // #given
      const hook = createThinkingBlockValidatorHook()
      const messages = [
        { info: { id: "msg-1", role: "user", modelID: "claude-opus-4-5" }, parts: [{ type: "text", text: "Hello" }] },
        { 
          info: { id: "msg-2", role: "assistant" }, 
          parts: [
            { type: "thinking", thinking: "Let me think..." },
            { type: "tool", id: "tool-1" }
          ] 
        },
      ]
      const output = { messages }
      const originalLength = messages[1].parts.length

      // #when
      await hook["experimental.chat.messages.transform"]!({} as never, output as any)

      // #then - should not add another thinking block
      const assistantMsg = output.messages.find(m => m.info.role === "assistant")
      expect(assistantMsg?.parts.length).toBe(originalLength)
    })

    it("#then should use previous thinking content when available", async () => {
      // #given
      const hook = createThinkingBlockValidatorHook()
      const previousThinking = "I need to analyze this carefully..."
      const messages = [
        { info: { id: "msg-1", role: "user", modelID: "claude-sonnet-4-5" }, parts: [{ type: "text", text: "Hello" }] },
        { 
          info: { id: "msg-2", role: "assistant" }, 
          parts: [
            { type: "thinking", thinking: previousThinking },
            { type: "text", text: "Response" }
          ] 
        },
        { info: { id: "msg-3", role: "user", modelID: "claude-sonnet-4-5" }, parts: [{ type: "text", text: "Continue" }] },
        { 
          info: { id: "msg-4", role: "assistant" }, 
          parts: [{ type: "tool", id: "tool-1" }] 
        },
      ]
      const output = { messages }

      // #when
      await hook["experimental.chat.messages.transform"]!({} as never, output as any)

      // #then - should use previous thinking content
      const lastAssistant = output.messages[3]
      expect(lastAssistant.parts[0].type).toBe("thinking")
      expect((lastAssistant.parts[0] as any).thinking).toBe(previousThinking)
    })

    it("#then should use placeholder when no previous thinking exists", async () => {
      // #given
      const hook = createThinkingBlockValidatorHook()
      const messages = [
        { info: { id: "msg-1", role: "user", modelID: "claude-opus-4" }, parts: [{ type: "text", text: "Hello" }] },
        { info: { id: "msg-2", role: "assistant" }, parts: [{ type: "tool", id: "tool-1" }] },
      ]
      const output = { messages }

      // #when
      await hook["experimental.chat.messages.transform"]!({} as never, output as any)

      // #then - should use placeholder
      const assistantMsg = output.messages.find(m => m.info.role === "assistant")
      expect((assistantMsg?.parts[0] as any).thinking).toBe("[Continuing from previous reasoning]")
    })

    it("#then should handle messages without parts array", async () => {
      // #given
      const hook = createThinkingBlockValidatorHook()
      const messages = [
        { info: { id: "msg-1", role: "user", modelID: "claude-sonnet-4-5" }, parts: [{ type: "text", text: "Hello" }] },
        { info: { id: "msg-2", role: "assistant" }, parts: [] },
      ]
      const output = { messages }

      // #when - should not throw
      await hook["experimental.chat.messages.transform"]!({} as never, output as any)

      // #then - empty parts should remain empty (no content to prepend to)
      expect(output.messages[1].parts.length).toBe(0)
    })
  })

  describe("isExtendedThinkingModel detection", () => {
    it("#then should detect thinking variant models", async () => {
      // #given
      const hook = createThinkingBlockValidatorHook()
      const thinkingModels = [
        "claude-sonnet-4-5-thinking",
        "claude-opus-4-5-thinking-high",
        "anthropic/claude-sonnet-4-thinking",
      ]

      for (const modelID of thinkingModels) {
        const messages = [
          { info: { id: "msg-1", role: "user", modelID }, parts: [{ type: "text", text: "Test" }] },
          { info: { id: "msg-2", role: "assistant" }, parts: [{ type: "tool", id: "t1" }] },
        ]
        const output = { messages }

        // #when
        await hook["experimental.chat.messages.transform"]!({} as never, output as any)

        // #then
        expect(output.messages[1].parts[0].type).toBe("thinking")
      }
    })

    it("#then should detect -high variant models", async () => {
      // #given
      const hook = createThinkingBlockValidatorHook()
      const messages = [
        { info: { id: "msg-1", role: "user", modelID: "claude-opus-4-5-high" }, parts: [{ type: "text", text: "Test" }] },
        { info: { id: "msg-2", role: "assistant" }, parts: [{ type: "tool", id: "t1" }] },
      ]
      const output = { messages }

      // #when
      await hook["experimental.chat.messages.transform"]!({} as never, output as any)

      // #then
      expect(output.messages[1].parts[0].type).toBe("thinking")
    })

    it("#then should detect claude-4 family models", async () => {
      // #given
      const hook = createThinkingBlockValidatorHook()
      const claude4Models = ["claude-sonnet-4", "claude-opus-4", "claude-sonnet-4-5"]

      for (const modelID of claude4Models) {
        const messages = [
          { info: { id: "msg-1", role: "user", modelID }, parts: [{ type: "text", text: "Test" }] },
          { info: { id: "msg-2", role: "assistant" }, parts: [{ type: "tool", id: "t1" }] },
        ]
        const output = { messages }

        // #when
        await hook["experimental.chat.messages.transform"]!({} as never, output as any)

        // #then
        expect(output.messages[1].parts[0].type).toBe("thinking")
      }
    })
  })
})

import { describe, expect, it } from "bun:test"

import type { Message, Part } from "@opencode-ai/sdk"

import { createMessageBatchCompressorHook } from "./create-message-batch-compressor-hook"

type MessageWithParts = {
  info: Message
  parts: Part[]
}

function createMockMessage(overrides: {
  role?: "user" | "assistant"
  created?: number
  parts?: Part[]
}): MessageWithParts {
  const role = overrides.role ?? "assistant"
  const created = overrides.created ?? Date.now()

  return {
    info: {
      id: "test-msg-id",
      sessionID: "test-session",
      role,
      time: { created },
    } as Message,
    parts: overrides.parts ?? [{ type: "text", text: "test content" }] as Part[],
  }
}

describe("createMessageBatchCompressorHook", () => {
  describe("extractBatchData - timestamp preservation", () => {
    it("should include timestamp from message.info.time.created in compressed data", async () => {
      //#given a batch of messages with timestamps
      const config = { enabled: true, threshold: 5000 }
      const hook = createMessageBatchCompressorHook(config)
      const testTimestamp = 1706659200000

      const messages: MessageWithParts[] = [
        createMockMessage({ role: "user", created: testTimestamp }),
        createMockMessage({ role: "assistant", created: testTimestamp + 1000 }),
        createMockMessage({ role: "user", created: testTimestamp + 2000 }),
        createMockMessage({ role: "assistant", created: testTimestamp + 3000 }),
        createMockMessage({ role: "user", created: testTimestamp + 4000 }),
      ]

      const output = { messages }

      //#when the hook compresses the batch
      await hook["experimental.chat.messages.transform"]!({}, output)

      //#then compressed output should exist (compression preserves structure including timestamps)
      expect(output.messages.length).toBe(1)
      expect(output.messages[0].info.id).toBe("compressed-batch")

      const compressedText = (output.messages[0].parts[0] as { text?: string }).text
      expect(compressedText).toBeDefined()
      expect(compressedText).toContain("timestamp")
    })

    it("should handle messages without time field gracefully", async () => {
      //#given messages without time field
      const config = { enabled: true, threshold: 5000 }
      const hook = createMessageBatchCompressorHook(config)

      const messages: MessageWithParts[] = [
        {
          info: { id: "msg-1", role: "user" } as Message,
          parts: [{ type: "text", text: "hello" }] as Part[],
        },
        {
          info: { id: "msg-2", role: "assistant" } as Message,
          parts: [{ type: "text", text: "world" }] as Part[],
        },
        {
          info: { id: "msg-3", role: "user" } as Message,
          parts: [{ type: "text", text: "test" }] as Part[],
        },
        {
          info: { id: "msg-4", role: "assistant" } as Message,
          parts: [{ type: "text", text: "response" }] as Part[],
        },
        {
          info: { id: "msg-5", role: "user" } as Message,
          parts: [{ type: "text", text: "end" }] as Part[],
        },
      ]

      const output = { messages }

      //#when the hook processes messages without timestamps
      await hook["experimental.chat.messages.transform"]!({}, output)

      //#then should not throw and should still compress
      expect(output.messages.length).toBe(1)
      const compressedText = (output.messages[0].parts[0] as { text?: string }).text
      expect(compressedText).toContain("timestamp")
      expect(compressedText).toContain("null")
    })
  })

  describe("compression behavior", () => {
    it("should NOT compress when disabled", async () => {
      //#given disabled compression config
      const config = { enabled: false, threshold: 5000 }
      const hook = createMessageBatchCompressorHook(config)

      const messages: MessageWithParts[] = Array(10)
        .fill(null)
        .map((_, i) => createMockMessage({ created: Date.now() + i }))

      const output = { messages }

      //#when hook is called
      await hook["experimental.chat.messages.transform"]!({}, output)

      //#then messages should remain unchanged
      expect(output.messages.length).toBe(10)
    })

    it("should NOT compress when batch size is below MIN_BATCH_SIZE", async () => {
      //#given only 4 messages (below MIN_BATCH_SIZE of 5)
      const config = { enabled: true, threshold: 5000 }
      const hook = createMessageBatchCompressorHook(config)

      const messages: MessageWithParts[] = [
        createMockMessage({}),
        createMockMessage({}),
        createMockMessage({}),
        createMockMessage({}),
      ]

      const output = { messages }

      //#when hook is called
      await hook["experimental.chat.messages.transform"]!({}, output)

      //#then messages should remain unchanged
      expect(output.messages.length).toBe(4)
    })
  })
})

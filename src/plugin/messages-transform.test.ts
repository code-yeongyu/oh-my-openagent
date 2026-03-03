import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import type { Message, Part } from "@opencode-ai/sdk"
import type { CreatedHooks } from "./create-hooks"
import { setGlobalCompressionConfig, resetGlobalCompressionConfig } from "../shared/toon-compression/config-store"

const encodeMock = mock((value: unknown) => `toon:${JSON.stringify(value)}`)

mock.module("@toon-format/toon", () => ({
  encode: encodeMock,
}))

import { createMessagesTransformHandler } from "./messages-transform"

type MessageWithParts = {
  info: Message
  parts: Part[]
}

function createMockHooks(): CreatedHooks {
  return {
    contextInjectorMessagesTransform: {
      "experimental.chat.messages.transform": async () => {},
    },
    thinkingBlockValidator: null,
  } as unknown as CreatedHooks
}

function createMockMessage(
  role: "user" | "assistant",
  content: string,
  id = "msg-1"
): MessageWithParts {
  return {
    info: {
      id,
      role,
      content,
      createdAt: new Date().toISOString(),
    } as Message,
    parts: [{ type: "text", text: content }] as Part[],
  }
}

function createUniformMessages(count: number): MessageWithParts[] {
  return Array.from({ length: count }, (_, i) =>
    createMockMessage("assistant", JSON.stringify({ id: i, status: "ok", data: `item-${i}` }), `msg-${i}`)
  )
}

describe("messages-transform compression", () => {
  beforeEach(() => {
    encodeMock.mockReset()
    encodeMock.mockImplementation((value: unknown) => `toon:${JSON.stringify(value)}`)
  })

  afterEach(() => {
    resetGlobalCompressionConfig()
  })

  describe("#given compression disabled", () => {
    test("#then passes messages through unchanged", async () => {
      const hooks = createMockHooks()
      const handler = createMessagesTransformHandler({ hooks })
      const messages = createUniformMessages(6)
      const output = { messages }

      await handler({}, output)

      expect(output.messages.length).toBe(6)
      expect(output.messages[0].parts[0]).toEqual({ type: "text", text: expect.any(String) })
    })
  })

  describe("#given compression enabled with eligible batch", () => {
    test("#then compresses uniform message array when threshold met", async () => {
      setGlobalCompressionConfig({ enabled: true, threshold: 100 })

      const hooks: CreatedHooks = {
        contextInjectorMessagesTransform: {
          "experimental.chat.messages.transform": async () => {},
        },
        thinkingBlockValidator: null,
        messageBatchCompressor: {
          "experimental.chat.messages.transform": async (_input, output) => {
            const { messages } = output
            if (messages.length < 5) return

            const batchData = messages.map((m) => ({
              role: m.info.role,
              content: (m.parts[0] as { text?: string })?.text ?? "",
            }))

            const { safeCompress } = await import("../shared/toon-compression")
            const compressed = safeCompress(batchData, "test-messages-transform")

            output.messages = [{
              info: { id: "compressed-batch", role: "assistant" } as Message,
              parts: [{ type: "text", text: compressed }] as Part[],
            }]
          },
        },
      } as unknown as CreatedHooks

      const handler = createMessagesTransformHandler({ hooks })
      const messages = createUniformMessages(6)
      const output = { messages }

      await handler({}, output)

      expect(output.messages.length).toBe(1)
      expect(encodeMock).toHaveBeenCalled()
    })
  })

  describe("#given small message batch below threshold", () => {
    test("#then does not compress when message count too small", async () => {
      const hooks = createMockHooks()
      const handler = createMessagesTransformHandler({ hooks })
      const messages = [createMockMessage("user", "hello"), createMockMessage("assistant", "hi")]
      const output = { messages }

      await handler({}, output)

      expect(output.messages.length).toBe(2)
    })
  })
})

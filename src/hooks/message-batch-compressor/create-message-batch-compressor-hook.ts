import type { Message, Part } from "@opencode-ai/sdk"
import type { ToonCompressionConfig } from "../../config/schema/toon-compression"

import { safeCompress } from "../../shared/toon-compression"
import { log } from "../../shared"

type MessageWithParts = {
  info: Message
  parts: Part[]
}

type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => Promise<void>
}

const MIN_BATCH_SIZE = 5

function extractBatchData(messages: MessageWithParts[]): unknown[] {
  return messages.map((m) => ({
    role: m.info.role,
    content: (m.parts[0] as { text?: string })?.text ?? "",
  }))
}

export function createMessageBatchCompressorHook(
  config: ToonCompressionConfig
): MessagesTransformHook {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output

      if (!config.enabled) {
        return
      }

      if (messages.length < MIN_BATCH_SIZE) {
        return
      }

      const batchData = extractBatchData(messages)
      const compressed = safeCompress(batchData, config)

      output.messages = [
        {
          info: {
            id: "compressed-batch",
            role: "assistant",
          } as Message,
          parts: [{ type: "text", text: compressed }] as Part[],
        },
      ]

      log("[message-batch-compressor] Compressed message batch", {
        originalCount: messages.length,
        compressedLength: compressed.length,
      })
    },
  }
}

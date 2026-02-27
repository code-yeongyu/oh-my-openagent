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

type ExtractedToolUse = {
  tool: string
  callID: string
  input: Record<string, unknown>
}

type ExtractedToolResult = {
  callID: string
  output: unknown
  error: unknown
}

type ExtractedImage = {
  callID: string
  source: unknown
  mimeType: unknown
  data: unknown
  url: unknown
}

function extractBatchData(messages: MessageWithParts[]): unknown[] {
  return messages.map((message) => {
    const textContents: string[] = []
    const thinkingContents: string[] = []
    const toolUses: ExtractedToolUse[] = []
    const toolResults: ExtractedToolResult[] = []
    const images: ExtractedImage[] = []

    for (const part of message.parts) {
      const maybePart = part as {
        type?: string
        text?: string
        thinking?: string
        tool?: string
        callID?: string
        input?: Record<string, unknown>
        output?: unknown
        error?: unknown
        source?: unknown
        mimeType?: unknown
        data?: unknown
        url?: unknown
      }

      if (maybePart.type === "text") {
        textContents.push(typeof maybePart.text === "string" ? maybePart.text : "")
        continue
      }

      if (maybePart.type === "thinking") {
        thinkingContents.push(
          typeof maybePart.thinking === "string" ? maybePart.thinking : ""
        )
        continue
      }

      if (maybePart.type === "tool_use") {
        toolUses.push({
          tool: typeof maybePart.tool === "string" ? maybePart.tool : "",
          callID: typeof maybePart.callID === "string" ? maybePart.callID : "",
          input: maybePart.input ?? {},
        })
        continue
      }

      if (maybePart.type === "tool_result") {
        toolResults.push({
          callID: typeof maybePart.callID === "string" ? maybePart.callID : "",
          output: maybePart.output ?? "",
          error: maybePart.error ?? "",
        })
        continue
      }

      if (maybePart.type === "image") {
        images.push({
          callID: typeof maybePart.callID === "string" ? maybePart.callID : "",
          source: maybePart.source,
          mimeType: maybePart.mimeType,
          data: maybePart.data,
          url: maybePart.url,
        })
      }
    }

    return {
      role: message.info.role,
      textContents,
      thinkingContents,
      toolUses,
      toolResults,
      images,
    }
  })
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

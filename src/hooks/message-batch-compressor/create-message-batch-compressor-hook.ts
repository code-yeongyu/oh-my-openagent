import type { Message, Part } from "@opencode-ai/sdk"
import type { ToonCompressionConfig } from "../../config/schema/toon-compression"

import { THINKING_TYPES } from "../session-recovery/constants"

import { safeCompress, evaluateCompressionConditions } from "../../shared/toon-compression"
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

function safeStringify(data: unknown): string {
  try {
    const serialized = JSON.stringify(data)
    if (typeof serialized === "string") {
      return serialized
    }

    return String(data)
  } catch {
    return String(data)
  }
}


function extractBatchData(messages: MessageWithParts[]): { batchData: unknown[]; imageParts: Part[] } {
  const imageParts: Part[] = []

  const batchData = messages.map((message) => {
    const textContents: string[] = []
    const thinkingContents: string[] = []
    const toolUses: ExtractedToolUse[] = []
    const toolResults: ExtractedToolResult[] = []

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

      if (THINKING_TYPES.has(maybePart.type as string)) {
        const content = maybePart.type === "thinking"
          ? maybePart.thinking
          : maybePart.text
        thinkingContents.push(typeof content === "string" ? content : "")
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
        imageParts.push(part)
        continue
      }
    }

    return {
      role: message.info.role,
      timestamp: message.info.time?.created ?? null,
      textContents,
      thinkingContents,
      toolUses,
      toolResults,
    }
  })

  return { batchData, imageParts }
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

      const { batchData, imageParts } = extractBatchData(messages)

      const evaluation = evaluateCompressionConditions(batchData, config.threshold)

      // TEMPORARY: Debug logging - remove when PR merged to upstream/dev
      const c = evaluation.conditions
      log(`[message-batch-compressor] trigger: validThreshold=${c.validThreshold}, notNull=${c.notNullOrUndefined}, notBinary=${c.notBinaryLike}, notError=${c.notErrorLike}, aboveThreshold=${c.aboveThreshold}, isArray=${c.isArray}, arrayLongEnough=${c.arrayLongEnough}, isUniform=${c.isUniformArray} → ${evaluation.decision ? 'COMPRESS' : 'SKIP'} (${evaluation.blockingReason || 'eligible batch'})`)

      if (!evaluation.decision) {
        return
      }

      const originalPayload = safeStringify(batchData)
      const compressed = safeCompress(batchData, config, "message-batch-compressor")

      const compressionApplied = compressed !== originalPayload
      if (!compressionApplied) {
        return
      }

      const parts: Part[] = [{ type: "text", text: compressed } as Part, ...imageParts]

      output.messages = [
        {
          info: {
            id: "compressed-batch",
            role: "assistant",
          } as Message,
          parts,
        },
      ]

      log("[message-batch-compressor] Compressed message batch", {
        originalCount: messages.length,
        compressedLength: compressed.length,
        imageCount: imageParts.length,
      })
    },
  }
}

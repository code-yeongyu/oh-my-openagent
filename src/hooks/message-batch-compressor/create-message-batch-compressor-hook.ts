import type { Message, Part } from "@opencode-ai/sdk"
import type { ToonCompressionConfig } from "../../config/schema/toon-compression"

import { THINKING_TYPES } from "../session-recovery/constants"

import { compressForLLM, evaluateCompressionConditions } from "../../shared/toon-compression"
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

type ExtractedTool = {
  tool: string
  callID: string
  input: Record<string, unknown>
  output?: string
  error?: string
  status: "pending" | "running" | "completed" | "error"
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


function extractBatchData(messages: MessageWithParts[]): { batchData: unknown[]; fileParts: Part[] } {
  const fileParts: Part[] = []

  const batchData = messages.map((message) => {
    const textContents: string[] = []
    const thinkingContents: string[] = []
    const tools: ExtractedTool[] = []

    for (const part of message.parts) {
      const maybePart = part as {
        type?: string
        text?: string
        thinking?: string
        tool?: string
        callID?: string
        state?: {
          status?: string
          input?: Record<string, unknown>
          output?: string
          error?: string
        }
        mime?: string
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

      if (maybePart.type === "tool" && maybePart.state) {
        tools.push({
          tool: typeof maybePart.tool === "string" ? maybePart.tool : "",
          callID: typeof maybePart.callID === "string" ? maybePart.callID : "",
          input: maybePart.state.input ?? {},
          output: maybePart.state.output,
          error: maybePart.state.error,
          status: (maybePart.state.status as ExtractedTool["status"]) ?? "pending",
        })
        continue
      }

      if (maybePart.type === "file") {
        fileParts.push(part)
        continue
      }
    }

    return {
      role: message.info.role,
      timestamp: message.info.time?.created ?? null,
      textContents,
      thinkingContents,
      tools,
    }
  })

  return { batchData, fileParts }
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

      const { batchData, fileParts } = extractBatchData(messages)

      const evaluation = evaluateCompressionConditions(batchData, config.threshold)

      // TEMPORARY: Debug logging - remove when PR merged to upstream/dev
      const c = evaluation.conditions
      log(`[message-batch-compressor] trigger: validThreshold=${c.validThreshold}, notNull=${c.notNullOrUndefined}, notBinary=${c.notBinaryLike}, notError=${c.notErrorLike}, aboveThreshold=${c.aboveThreshold}, isArray=${c.isArray}, arrayLongEnough=${c.arrayLongEnough}, isUniform=${c.isUniformArray} → ${evaluation.decision ? 'COMPRESS' : 'SKIP'} (${evaluation.blockingReason || 'eligible batch'})`)

      if (!evaluation.decision) {
        return
      }

      const originalPayload = safeStringify(batchData)
      const compressed = compressForLLM(batchData, config, "message-batch-compressor")

      const compressionApplied = compressed !== originalPayload
      if (!compressionApplied) {
        return
      }

      const parts: Part[] = [{ type: "text", text: compressed } as Part, ...fileParts]

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
        fileCount: fileParts.length,
      })
    },
  }
}

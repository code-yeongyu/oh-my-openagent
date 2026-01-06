import type { Message, Part } from "@opencode-ai/sdk"

interface MessageWithParts {
  info: Message
  parts: Part[]
}

type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => Promise<void>
}

function isExtendedThinkingModel(modelID: string): boolean {
  if (!modelID) return false
  const lower = modelID.toLowerCase()

  if (lower.includes("thinking") || lower.endsWith("-high")) {
    return true
  }

  return (
    lower.includes("claude-sonnet-4") ||
    lower.includes("claude-opus-4") ||
    lower.includes("claude-3")
  )
}

function hasContentParts(parts: Part[]): boolean {
  if (!parts || parts.length === 0) return false

  return parts.some((part: Part) => {
    const type = part.type as string
    return type === "tool" || type === "tool_use" || type === "text"
  })
}

function startsWithThinkingBlock(parts: Part[]): boolean {
  if (!parts || parts.length === 0) return false

  const firstPart = parts[0]
  const type = firstPart.type as string
  return type === "thinking" || type === "reasoning"
}

function findPreviousThinkingContent(
  messages: MessageWithParts[],
  currentIndex: number
): string {
  for (let i = currentIndex - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.info.role !== "assistant") continue

    if (!msg.parts) continue
    for (const part of msg.parts) {
      const type = part.type as string
      if (type === "thinking" || type === "reasoning") {
        const thinking = (part as { thinking?: string; text?: string }).thinking || (part as { thinking?: string; text?: string }).text
        if (thinking && typeof thinking === "string" && thinking.trim().length > 0) {
          return thinking
        }
      }
    }
  }

  return ""
}

function prependThinkingBlock(
  message: MessageWithParts,
  thinkingContent: string
): void {
  if (!message.parts) {
    message.parts = []
  }

  const thinkingPart = {
    type: "thinking" as const,
    id: `prt_0000000000_synthetic_thinking`,
    sessionID: (message.info as { sessionID?: string }).sessionID || "",
    messageID: message.info.id,
    thinking: thinkingContent,
    synthetic: true,
  }

  message.parts.unshift(thinkingPart as unknown as Part)
}

export function createThinkingBlockValidatorHook(): MessagesTransformHook {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output

      if (!messages || messages.length === 0) {
        return
      }

      const lastUserMessage = messages.findLast(m => m.info.role === "user")
      const modelID = (lastUserMessage?.info as { modelID?: string })?.modelID || ""

      if (!isExtendedThinkingModel(modelID)) {
        return
      }

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]

        if (msg.info.role !== "assistant") continue

        if (hasContentParts(msg.parts) && !startsWithThinkingBlock(msg.parts)) {
          const previousThinking = findPreviousThinkingContent(messages, i)

          const thinkingContent = previousThinking || "[Continuing from previous reasoning]"

          prependThinkingBlock(msg, thinkingContent)
        }
      }
    },
  }
}

import type { Message, Part } from "@opencode-ai/sdk"

const PLACEHOLDER_TEXT = "[user interrupted]"

interface MessageWithParts {
  info: Message
  parts: Part[]
}

type MessagesTransformHook = {
// NOTE: This sanitizer runs on experimental.chat.messages.transform hook,
// which executes AFTER chat.message hooks. Filesystem-injected messages
// from hooks like claude-code-hooks and keyword-detector may bypass this
// sanitizer if they inject empty content. Validation should be done at
// injection time in injectHookMessage().

  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => Promise<void>
}

function hasTextContent(part: Part): boolean {
  if (part.type === "text") {
    const text = (part as unknown as { text?: string }).text
    return Boolean(text && text.trim().length > 0)
  }
  return false
}

function isToolPart(part: Part): boolean {
  const type = part.type as string
  return type === "tool" || type === "tool_use" || type === "tool_result"
}

function hasValidContent(parts: Part[]): boolean {
  return parts.some((part) => hasTextContent(part) || isToolPart(part))
}

export function createEmptyMessageSanitizerHook(): MessagesTransformHook {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output

      for (const message of messages) {
        if (message.info.role === "user") continue

        const parts = message.parts

        // FIX: Removed `&& parts.length > 0` - empty arrays also need sanitization
        // When parts is [], the message has no content and would cause API error:
        // "all messages must have non-empty content except for the optional final assistant message"
        if (!hasValidContent(parts)) {
          let injected = false

          for (const part of parts) {
            if (part.type === "text") {
              const textPart = part as unknown as { text?: string; synthetic?: boolean }
              if (!textPart.text || !textPart.text.trim()) {
                textPart.text = PLACEHOLDER_TEXT
                textPart.synthetic = true
                injected = true
                break
              }
            }
          }

          if (!injected) {
            const insertIndex = parts.findIndex((p) => isToolPart(p))

            const newPart = {
              id: `synthetic_${Date.now()}`,
              messageID: message.info.id,
              sessionID: (message.info as unknown as { sessionID?: string }).sessionID ?? "",
              type: "text" as const,
              text: PLACEHOLDER_TEXT,
              synthetic: true,
            }

            if (insertIndex === -1) {
              parts.push(newPart as Part)
            } else {
              parts.splice(insertIndex, 0, newPart as Part)
            }
          }
        }

        for (const part of parts) {
          if (part.type === "text") {
            const textPart = part as unknown as { text?: string; synthetic?: boolean }
            if (textPart.text !== undefined && textPart.text.trim() === "") {
              textPart.text = PLACEHOLDER_TEXT
              textPart.synthetic = true
            }
          }
        }
      }
    },
  }
}

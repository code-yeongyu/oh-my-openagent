/**
 * Proactive Thinking Block Validator Hook
 *
 * Prevents "Expected thinking/redacted_thinking but found tool_use" errors
 * by validating and fixing message structure BEFORE sending to Anthropic API.
 *
 * This hook runs on the "experimental.chat.messages.transform" hook point,
 * which is called before messages are converted to ModelMessage format and
 * sent to the API.
 *
 * Key differences from session-recovery hook:
 * - PROACTIVE (prevents error) vs REACTIVE (fixes after error)
 * - Runs BEFORE API call vs AFTER API error
 * - User never sees the error vs User sees error then recovery
 */

import type { Message, Part } from "@opencode-ai/sdk"

interface MessageWithParts {
  info: Message
  parts: Part[]
}

type SignedThinkingPart = Part & {
  type: "thinking" | "redacted_thinking"
  signature: string
}

type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => Promise<void>
}

/**
 * Check if a model has extended thinking enabled
 * Uses patterns from think-mode/switcher.ts for consistency
 */
function isExtendedThinkingModel(modelID: string): boolean {
  if (!modelID) return false
  const lower = modelID.toLowerCase()

  // Check for explicit thinking/high variants (always enabled)
  if (lower.includes("thinking") || lower.endsWith("-high")) {
    return true
  }

  // Check for thinking-capable models (claude-4 family, claude-3)
  // Aligns with THINKING_CAPABLE_MODELS in think-mode/switcher.ts
  return (
    lower.includes("claude-sonnet-4") ||
    lower.includes("claude-opus-4") ||
    lower.includes("claude-3")
  )
}

/**
 * Check if a message has any content parts (tool_use, text, or other non-thinking content)
 */
function hasContentParts(parts: Part[]): boolean {
  if (!parts || parts.length === 0) return false

  return parts.some((part: Part) => {
    const type = part.type as string
    // Include tool parts and text parts (anything that's not thinking/reasoning)
    return type === "tool" || type === "tool_use" || type === "text"
  })
}

/**
 * Check if a message starts with a thinking/reasoning block
 */
function startsWithThinkingBlock(parts: Part[]): boolean {
  if (!parts || parts.length === 0) return false

  const firstPart = parts[0]
  const type = firstPart.type as string
  return type === "thinking" || type === "redacted_thinking" || type === "reasoning"
}

function isSignedThinkingPart(part: Part): part is SignedThinkingPart {
  const type = part.type as string
  if (type !== "thinking" && type !== "redacted_thinking") {
    return false
  }

  const signature = (part as { signature?: unknown }).signature
  return typeof signature === "string" && signature.length > 0
}

function findPreviousThinkingPart(
  messages: MessageWithParts[],
  currentIndex: number
): SignedThinkingPart | null {
  // Search backwards from current message
  for (let i = currentIndex - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.info.role !== "assistant") continue

    if (!msg.parts) continue
    for (const part of msg.parts) {
      if (isSignedThinkingPart(part)) {
        return part
      }
    }
  }

  return null
}

function prependThinkingBlock(message: MessageWithParts, thinkingPart: SignedThinkingPart): void {
  if (!message.parts) {
    message.parts = []
  }

  message.parts.unshift(thinkingPart)
}

/**
 * Validate and fix assistant messages that have tool_use but no thinking block
 */
export function createThinkingBlockValidatorHook(): MessagesTransformHook {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output

      if (!messages || messages.length === 0) {
        return
      }

      // Get the model info from the last user message
      const lastUserMessage = messages.findLast(m => m.info.role === "user")
      const modelIDValue = (lastUserMessage?.info as { modelID?: unknown } | undefined)?.modelID
      const modelID = typeof modelIDValue === "string" ? modelIDValue : ""

      // Only process if extended thinking might be enabled
      if (!isExtendedThinkingModel(modelID)) {
        return
      }

      // Process all assistant messages
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]

        // Only check assistant messages
        if (msg.info.role !== "assistant") continue

        // Check if message has content parts but doesn't start with thinking
        if (hasContentParts(msg.parts) && !startsWithThinkingBlock(msg.parts)) {
          const previousThinkingPart = findPreviousThinkingPart(messages, i)
          if (!previousThinkingPart) {
            continue
          }

          prependThinkingBlock(msg, previousThinkingPart)
        }
      }
    },
  }
}

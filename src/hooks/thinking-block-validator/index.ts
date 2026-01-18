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

// Meta types that don't count as "content" for thinking validation
const META_TYPES = new Set(["step-start", "step-finish"])

/**
 * Check if a message starts with a thinking/reasoning block
 * Skips meta-types like step-start/step-finish
 */
function startsWithThinkingBlock(parts: Part[]): boolean {
  if (!parts || parts.length === 0) return false

  // Find first non-meta part
  const firstContentPart = parts.find(p => !META_TYPES.has(p.type as string))
  if (!firstContentPart) return false

  const type = firstContentPart.type as string
  return type === "thinking" || type === "reasoning"
}

/**
 * Find the most recent thinking content from previous assistant messages
 */
function findPreviousThinkingContent(
  messages: MessageWithParts[],
  currentIndex: number
): string {
  // Search backwards from current message
  for (let i = currentIndex - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.info.role !== "assistant") continue

    // Look for thinking parts
    if (!msg.parts) continue
    for (const part of msg.parts) {
      const type = part.type as string
      if (type === "thinking" || type === "reasoning") {
        const thinking = (part as any).thinking || (part as any).text
        if (thinking && typeof thinking === "string" && thinking.trim().length > 0) {
          return thinking
        }
      }
    }
  }

  return ""
}

/**
 * Prepend a thinking block to a message's parts array
 */
function prependThinkingBlock(
  message: MessageWithParts,
  thinkingContent: string
): void {
  if (!message.parts) {
    message.parts = []
  }

  // Create synthetic thinking part
  const thinkingPart = {
    type: "thinking" as const,
    id: `prt_0000000000_synthetic_thinking`,
    sessionID: (message.info as any).sessionID || "",
    messageID: message.info.id,
    thinking: thinkingContent,
    synthetic: true,
  }

  // Prepend to parts array
  message.parts.unshift(thinkingPart as unknown as Part)
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
      // Model can be in info.modelID, info.model.modelID, or info.model (string)
      const lastUserMessage = messages.findLast(m => m.info.role === "user")
      const info = lastUserMessage?.info as any
      const modelID = info?.modelID
        || info?.model?.modelID
        || (typeof info?.model === "string" ? info.model : "")
        || ""

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
          // Find thinking content from previous turns
          const previousThinking = findPreviousThinkingContent(messages, i)

          // Prepend thinking block with content from previous turn or placeholder
          const thinkingContent = previousThinking || "[Continuing from previous reasoning]"

          prependThinkingBlock(msg, thinkingContent)
        }
      }
    },
  }
}

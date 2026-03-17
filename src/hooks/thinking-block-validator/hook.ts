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

interface MessageInfoExtended {
  id: string
  role: string
  sessionID?: string
  modelID?: string
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
  return type === "thinking" || type === "reasoning"
}

/**
 * Find the most recent real thinking part from previous assistant messages.
 *
 * Returns the original Part object (including its `signature` field) so it can
 * be reused verbatim in another message.  Synthetic parts — those that were
 * injected by a previous run of this hook — are intentionally skipped because
 * they lack a valid `signature` and would be rejected by the Anthropic API with
 * "Invalid `signature` in `thinking` block".
 */
function findPreviousThinkingPart(
  messages: MessageWithParts[],
  currentIndex: number
): Part | null {
  // Search backwards from current message
  for (let i = currentIndex - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.info.role !== "assistant") continue
    if (!msg.parts) continue

    for (const part of msg.parts) {
      const type = part.type as string
      if (type !== "thinking" && type !== "reasoning") continue

      // Skip synthetic parts — they have no valid signature
      if ((part as unknown as { synthetic?: boolean }).synthetic) continue

      return part
    }
  }

  return null
}

/**
 * Prepend an existing thinking block (with its original signature) to a
 * message's parts array.
 *
 * We reuse the original Part verbatim instead of creating a new one, because
 * the Anthropic API validates the `signature` field against the thinking
 * content.  Any synthetic block we create ourselves would fail that check.
 */
function prependThinkingBlock(message: MessageWithParts, thinkingPart: Part): void {
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
      const modelID = (lastUserMessage?.info as unknown as MessageInfoExtended)?.modelID || ""

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
          // Find the most recent real thinking part (with valid signature) from
          // previous turns.  If none exists we cannot safely inject a thinking
          // block — a synthetic block without a signature would cause the API
          // to reject the request with "Invalid `signature` in `thinking` block".
          const previousThinkingPart = findPreviousThinkingPart(messages, i)

          if (previousThinkingPart) {
            prependThinkingBlock(msg, previousThinkingPart)
          }
          // If no real thinking part is available, skip injection entirely.
          // The downstream error (if any) is preferable to a guaranteed API
          // rejection caused by a signature-less synthetic thinking block.
        }
      }
    },
  }
}

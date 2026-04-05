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

type SignedThinkingPart = Part & {
  type: "thinking" | "redacted_thinking"
  thinking?: string
  signature: string
  synthetic?: boolean
}

function isSignedThinkingPart(part: Part): part is SignedThinkingPart {
  const type = part.type as string
  if (type !== "thinking" && type !== "redacted_thinking") {
    return false
  }

  const signature = (part as { signature?: unknown }).signature
  const synthetic = (part as { synthetic?: unknown }).synthetic
  return typeof signature === "string" && signature.length > 0 && synthetic !== true
}

/**
 * Check if there are any Anthropic-signed thinking blocks in the message history.
 *
 * Only returns true for real `type: "thinking"` blocks with a valid `signature`.
 * GPT reasoning blocks (`type: "reasoning"`) are intentionally excluded - they
 * have no Anthropic signature and must never be forwarded to the Anthropic API.
 *
 * Model-name checks are unreliable (miss GPT+thinking, custom model IDs, etc.)
 * so we inspect the messages themselves.
 */
function hasSignedThinkingBlocksInHistory(messages: MessageWithParts[]): boolean {
  return messages.some(
    m =>
      m.info.role === "assistant" &&
      m.parts?.some((p: Part) => isSignedThinkingPart(p)),
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

/**
 * Find the most recent Anthropic-signed thinking part from previous assistant messages.
 *
 * Returns the original Part object (including its `signature` field) so it can
 * be reused verbatim in another message.  Only `type: "thinking"` blocks with
 * both a `signature` and `thinking` field are returned - GPT `type: "reasoning"`
 * blocks are excluded because they lack an Anthropic signature and would be
 * rejected by the API with "Invalid `signature` in `thinking` block".
 * Synthetic parts injected by a previous run of this hook are also skipped.
 */
function findPreviousThinkingPart(messages: MessageWithParts[], currentIndex: number): SignedThinkingPart | null {
  // Search backwards from current message
  for (let i = currentIndex - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.info.role !== "assistant") continue
    if (!msg.parts) continue

    for (const part of msg.parts) {
      // Only Anthropic thinking blocks - type must be "thinking", not "reasoning"
      if (!isSignedThinkingPart(part)) continue

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

      // Skip if there are no Anthropic-signed thinking blocks in history.
      // This is more reliable than checking model names - works for Claude,
      // GPT with thinking variants, or any future model.  Crucially, GPT
      // reasoning blocks (type="reasoning", no signature) do NOT trigger this
      // hook - only real Anthropic thinking blocks do.
      if (!hasSignedThinkingBlocksInHistory(messages)) {
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
          // block - a synthetic block without a signature would cause the API
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

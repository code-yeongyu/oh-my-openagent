import { HOST_DENIAL_REPLACEMENT_TEXT, HOST_TOOL_DENIAL_LEAK_TEXT } from "./constants"

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Swap every occurrence of the senpi claude-sdk-oauth host-denial instruction for a neutral,
 * non-instructional marker. Purely mechanical: text without the exact literal comes back
 * unchanged, and surrounding prose is never touched.
 */
export function sanitizeDenialLeakText(text: string): string {
  if (!text.includes(HOST_TOOL_DENIAL_LEAK_TEXT)) {
    return text
  }
  return text.split(HOST_TOOL_DENIAL_LEAK_TEXT).join(HOST_DENIAL_REPLACEMENT_TEXT)
}

function sanitizeTextBlocks(content: unknown[]): { content: unknown[]; changed: boolean } {
  let changed = false
  const next = content.map((block) => {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") {
      return block
    }
    const sanitized = sanitizeDenialLeakText(block.text)
    if (sanitized === block.text) {
      return block
    }
    changed = true
    return { ...block, text: sanitized }
  })
  return { content: next, changed }
}

/**
 * Neutralize the host-denial literal inside one finalized agent message. Only assistant and
 * toolResult messages are rewritten (user wording is never touched); returns undefined when the
 * message is already clean so handlers stay identity-preserving.
 */
export function sanitizeAgentMessage(message: unknown): { message: Record<string, unknown> } | undefined {
  if (!isRecord(message)) {
    return undefined
  }
  if (message.role !== "assistant" && message.role !== "toolResult") {
    return undefined
  }
  if (!Array.isArray(message.content)) {
    return undefined
  }
  const { content, changed } = sanitizeTextBlocks(message.content)
  if (!changed) {
    return undefined
  }
  return { message: { ...message, content } }
}

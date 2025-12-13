import {
  ULTRAWORK_PATTERNS,
  CODE_BLOCK_PATTERN,
  INLINE_CODE_PATTERN,
} from "./constants"

/**
 * Remove code blocks and inline code from text.
 * Prevents false positives when keywords appear in code.
 */
export function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "")
}

/**
 * Detect ultrawork keywords in text (excluding code blocks).
 */
export function detectUltraworkKeyword(text: string): boolean {
  const textWithoutCode = removeCodeBlocks(text)
  return ULTRAWORK_PATTERNS.some((pattern) => pattern.test(textWithoutCode))
}

/**
 * Extract text content from message parts.
 */
export function extractPromptText(
  parts: Array<{ type: string; text?: string }>
): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text || "")
    .join("")
}

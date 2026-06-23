/**
 * Non-streaming cleanser for inline `<think>...</think>` blocks.
 *
 * Used by consumers that read complete text strings (background-agent message
 * persistence, tool result formatting, session readers). For streaming text
 * deltas — where tags can be split across chunk boundaries — see the stateful
 * filter in `cli/run/inline-think-filter.ts`.
 *
 * Design notes:
 * - Both `<think>...</think>` and `<mm:think>...</mm:think>` are recognized.
 *   vLLM's MiniMax-M3 parser uses the `mm:` namespaced variant; opencode-go
 *   passes either through. The cleanser handles both with one pass.
 * - Unmatched opens (no closer in `text`) eat the remainder. This mirrors what
 *   gokin and ollama do: an unclosed `<think>` is conservatively treated as
 *   "reasoning until end of buffer" rather than leaking content.
 * - Unmatched closes (orphan `</think>` with no opener) are stripped silently.
 *   vLLM's `MiniMaxM3ReasoningParser` does the same special-casing — a stray
 *   leading closer can appear at response start when chat templates pre-fill
 *   the reasoning state.
 */

const OPEN_TAGS = ["<think>", "<mm:think>"] as const
const CLOSE_TAGS = ["</think>", "</mm:think>"] as const

export interface CleansedText {
  content: string
  reasoning: string
}

function findFirst(haystack: string, needles: readonly string[], from: number): {
  index: number
  needle: string
} {
  let bestIndex = -1
  let bestNeedle = ""
  for (const needle of needles) {
    const idx = haystack.indexOf(needle, from)
    if (idx === -1) continue
    if (bestIndex === -1 || idx < bestIndex) {
      bestIndex = idx
      bestNeedle = needle
    }
  }
  return { index: bestIndex, needle: bestNeedle }
}

/**
 * Strip inline think blocks from `text`, returning the visible content and
 * the extracted reasoning (concatenated, in order of appearance).
 *
 * If no think tags are present, the original text is returned verbatim as
 * `content` and `reasoning` is empty.
 */
export function stripInlineThink(text: string): CleansedText {
  if (text.length === 0) return { content: "", reasoning: "" }
  // Fast path: no opener and no orphan closer means nothing to do.
  if (
    !OPEN_TAGS.some((t) => text.includes(t)) &&
    !CLOSE_TAGS.some((t) => text.includes(t))
  ) {
    return { content: text, reasoning: "" }
  }

  let content = ""
  let reasoning = ""
  let cursor = 0
  let inside = false

  while (cursor < text.length) {
    if (!inside) {
      const open = findFirst(text, OPEN_TAGS, cursor)
      const orphan = findFirst(text, CLOSE_TAGS, cursor)

      // If an orphan closer appears before any opener, strip it and continue.
      if (orphan.index !== -1 && (open.index === -1 || orphan.index < open.index)) {
        content += text.slice(cursor, orphan.index)
        cursor = orphan.index + orphan.needle.length
        continue
      }

      if (open.index === -1) {
        content += text.slice(cursor)
        break
      }

      content += text.slice(cursor, open.index)
      cursor = open.index + open.needle.length
      inside = true
    } else {
      const close = findFirst(text, CLOSE_TAGS, cursor)
      if (close.index === -1) {
        // Unclosed opener: consume the rest as reasoning, suppress from content.
        reasoning += text.slice(cursor)
        break
      }
      reasoning += text.slice(cursor, close.index)
      cursor = close.index + close.needle.length
      inside = false
    }
  }

  return { content, reasoning }
}

/**
 * Convenience: strip and discard reasoning, returning only the cleaned content.
 * Most callers that just want to display text without the leak use this.
 */
export function stripInlineThinkContent(text: string): string {
  return stripInlineThink(text).content
}

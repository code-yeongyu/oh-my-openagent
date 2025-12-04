import type { CommentInfo, FilterResult } from "../types"
import { TYPE_CHECKER_PREFIXES } from "../constants"

function stripCommentPrefix(text: string): string {
  let stripped = text.trim().toLowerCase()
  const prefixes = ["#", "//", "/*", "--"]
  for (const prefix of prefixes) {
    if (stripped.startsWith(prefix)) {
      stripped = stripped.slice(prefix.length).trim()
    }
  }
  stripped = stripped.replace(/^@/, "")
  return stripped
}

export function filterDirectiveComments(comment: CommentInfo): FilterResult {
  const normalized = stripCommentPrefix(comment.text)
  for (const prefix of TYPE_CHECKER_PREFIXES) {
    if (normalized.startsWith(prefix.toLowerCase())) {
      return { shouldSkip: true, reason: `Directive: ${prefix}` }
    }
  }
  return { shouldSkip: false }
}

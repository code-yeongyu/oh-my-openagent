import type { CommentInfo, FilterResult } from "../types"
import { BDD_KEYWORDS } from "../constants"

function stripCommentPrefix(text: string): string {
  let stripped = text.trim().toLowerCase()
  const prefixes = ["#", "//", "--", "/*", "*/"]
  for (const prefix of prefixes) {
    if (stripped.startsWith(prefix)) {
      stripped = stripped.slice(prefix.length).trim()
    }
  }
  return stripped
}

export function filterBddComments(comment: CommentInfo): FilterResult {
  const normalized = stripCommentPrefix(comment.text)
  if (BDD_KEYWORDS.has(normalized)) {
    return { shouldSkip: true, reason: `BDD keyword: ${normalized}` }
  }
  return { shouldSkip: false }
}

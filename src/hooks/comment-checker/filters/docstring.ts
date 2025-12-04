import type { CommentInfo, FilterResult } from "../types"

export function filterDocstringComments(comment: CommentInfo): FilterResult {
  if (comment.isDocstring) {
    return { shouldSkip: true, reason: "Docstring" }
  }
  const trimmed = comment.text.trimStart()
  if (trimmed.startsWith("/**")) {
    return { shouldSkip: true, reason: "JSDoc/PHPDoc" }
  }
  return { shouldSkip: false }
}

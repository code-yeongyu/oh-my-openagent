import type { CommentInfo, FilterResult } from "../types"

export function filterShebangComments(comment: CommentInfo): FilterResult {
  const trimmed = comment.text.trimStart()
  if (trimmed.startsWith("#!")) {
    return { shouldSkip: true, reason: "Shebang" }
  }
  return { shouldSkip: false }
}

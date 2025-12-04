import type { FileComments } from "../types"
import { HOOK_MESSAGE_HEADER } from "../constants"
import { buildCommentsXml } from "./xml-builder"

export function formatHookMessage(fileCommentsList: FileComments[]): string {
  if (fileCommentsList.length === 0) {
    return ""
  }
  const xml = buildCommentsXml(fileCommentsList)
  return `${HOOK_MESSAGE_HEADER}${xml}\n`
}

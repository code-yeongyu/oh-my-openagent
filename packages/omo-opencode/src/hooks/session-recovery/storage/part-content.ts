import { THINKING_TYPES, META_TYPES } from "../constants"
import type { StoredPart, StoredTextPart } from "../types"
import { readParts } from "./parts-reader"

export function hasContent(part: StoredPart): boolean {
  if (THINKING_TYPES.has(part.type)) return false
  if (META_TYPES.has(part.type)) return false

  if (part.type === "text") {
    const textPart = part as StoredTextPart
    return !!textPart.text?.trim()
  }

  if (part.type === "tool" || part.type === "tool_use") {
    return true
  }

  if (part.type === "tool_result") {
    return true
  }

  return false
}

export function messageHasContent(messageID: string): boolean {
  const parts = readParts(messageID)
  return parts.some(hasContent)
}

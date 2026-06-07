import { isRealUserTextPart } from "../../shared"
import type { ChatMessagePart } from "./types"

export function extractPromptText(parts: readonly ChatMessagePart[]): string {
  return (
    parts
      .filter(isRealUserTextPart)
      .map((part) => part.text)
      .join("\n")
      .trim() || ""
  )
}

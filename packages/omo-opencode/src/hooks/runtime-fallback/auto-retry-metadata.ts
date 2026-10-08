import { isRecord } from "@oh-my-opencode/utils"
import { extractSessionMessages } from "./session-messages"
import { hasCompactionPart } from "../../shared/compaction-marker"
import { hasRuntimeFallbackRetryMarker, hasSubstantivePromptText } from "../../shared/runtime-fallback-retry-marker"
import { log } from "../../shared/logger"

export type RetryPromptPart = { type: "text"; text: string; id?: string }

type UserRetryPartRecord = Record<string, unknown> & { type: "text"; text: string }



export function resolveOriginalUserRetryMetadata(messagesResponse: unknown): {
  messageID?: string
  parts: RetryPromptPart[]
} {
  const messages = extractSessionMessages(messagesResponse)
  const lastUserMessage = messages?.filter((message) => {
    if (message.info?.role !== "user") return false
    const propParts = Array.isArray(message.parts) ? message.parts : undefined
    const infoParts = isRecord(message.info) && Array.isArray(message.info["parts"])
      ? message.info["parts"]
      : undefined
    const parts = propParts && propParts.length > 0 ? propParts : infoParts
    if (hasCompactionPart(parts)) {
      log("[runtime-fallback] retry-payload-skips-compaction-marker")
      return false
    }
    if (!hasSubstantivePromptText(parts)) {
      if (Array.isArray(parts) && parts.some((part) => isRecord(part)
        && typeof part["text"] === "string"
        && hasRuntimeFallbackRetryMarker(part["text"]))) {
        log("[runtime-fallback] retry-payload-skips-retry-marker")
      }
      return false
    }
    return true
  }).pop()
  const messageID = typeof lastUserMessage?.info?.id === "string" ? lastUserMessage.info.id : undefined
  const propParts = Array.isArray(lastUserMessage?.parts) ? lastUserMessage.parts : undefined
  const infoParts = isRecord(lastUserMessage?.info) && Array.isArray(lastUserMessage.info["parts"])
    ? lastUserMessage.info["parts"]
    : undefined
  const rawParts = propParts && propParts.length > 0
    ? propParts
    : infoParts ?? []
  const parts = rawParts
    .filter(
      (part): part is UserRetryPartRecord =>
        isRecord(part)
        && part["type"] === "text"
        && typeof part["text"] === "string"
        && part["text"].length > 0,
    )
    .map((part) => ({
      type: "text" as const,
      text: part["text"],
      ...(typeof part["id"] === "string" ? { id: part["id"] } : {}),
    }))

  return {
    ...(messageID ? { messageID } : {}),
    parts,
  }
}

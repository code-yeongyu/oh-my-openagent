import { isRecord } from "@oh-my-opencode/utils"
import { extractSessionMessages } from "./session-messages"

export type RetryPromptPart = { type: "text"; text: string; id?: string }

type UserRetryPartRecord = Record<string, unknown> & { type: "text"; text: string }



export function resolveOriginalUserRetryMetadata(messagesResponse: unknown): {
  messageID?: string
  parts: RetryPromptPart[]
} {
  const messages = extractSessionMessages(messagesResponse)
  const lastUserMessage = messages?.filter((message) => message.info?.role === "user").pop()
  const messageID = typeof lastUserMessage?.info?.id === "string" ? lastUserMessage.info.id : undefined
  const infoParts = isRecord(lastUserMessage?.info) ? lastUserMessage.info["parts"] : undefined
  const rawParts = Array.isArray(lastUserMessage?.parts)
    ? lastUserMessage.parts
    : Array.isArray(infoParts)
      ? infoParts
      : []
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

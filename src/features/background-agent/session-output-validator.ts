import type { OpencodeClient } from "./constants"
import { log } from "../../shared"

type SessionMessagePart = {
  type?: string
  text?: string
  content?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getMessageRole(message: unknown): string | undefined {
  if (!isObject(message)) return undefined
  const info = message["info"]
  if (!isObject(info)) return undefined
  const role = info["role"]
  return typeof role === "string" ? role : undefined
}

function getMessageParts(message: unknown): SessionMessagePart[] {
  if (!isObject(message)) return []
  const parts = message["parts"]
  if (!Array.isArray(parts)) return []

  return parts
    .filter((part): part is SessionMessagePart => isObject(part))
    .map((part) => ({
      type: typeof part["type"] === "string" ? part["type"] : undefined,
      text: typeof part["text"] === "string" ? part["text"] : undefined,
      content: part["content"],
    }))
}

function partHasContent(part: SessionMessagePart): boolean {
  if (part.type === "text" || part.type === "reasoning") {
    return Boolean(part.text && part.text.trim().length > 0)
  }
  if (part.type === "tool") return true
  if (part.type === "tool_result") {
    if (typeof part.content === "string") return part.content.trim().length > 0
    if (Array.isArray(part.content)) return part.content.length > 0
    return Boolean(part.content)
  }
  return false
}

export async function validateSessionHasOutput(
  client: OpencodeClient,
  sessionID: string
): Promise<boolean> {
  try {
    const response = await client.session.messages({
      path: { id: sessionID },
    })

    const messagesRaw =
      isObject(response) && "data" in response ? (response as { data?: unknown }).data : response
    const messages = Array.isArray(messagesRaw) ? messagesRaw : []

    const hasAssistantOrToolMessage = messages.some((message) => {
      const role = getMessageRole(message)
      return role === "assistant" || role === "tool"
    })

    if (!hasAssistantOrToolMessage) {
      log("[background-agent] No assistant/tool messages found in session:", sessionID)
      return false
    }

    const hasContent = messages.some((message) => {
      const role = getMessageRole(message)
      if (role !== "assistant" && role !== "tool") return false
      const parts = getMessageParts(message)
      return parts.some(partHasContent)
    })

    if (!hasContent) {
      log("[background-agent] Messages exist but no content found in session:", sessionID)
      return false
    }

    return true
  } catch (error) {
    log("[background-agent] Error validating session output:", error)
    return true
  }
}

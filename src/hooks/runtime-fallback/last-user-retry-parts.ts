import { extractSessionMessages } from "./session-messages"
import { getDelegatedChildSessionBootstrap } from "../../shared/delegated-child-session-bootstrap"

export function getLastUserRetryParts(
  messagesResponse: unknown,
  sessionID?: string,
): Array<{ type: "text"; text: string }> {
  const messages = extractSessionMessages(messagesResponse)
  const lastUserMessage = messages?.filter((message) => message.info?.role === "user").pop()
  const lastUserParts =
    lastUserMessage?.parts
    ?? (lastUserMessage?.info?.parts as Array<{ type?: string; text?: string }> | undefined)

  const retryParts = (lastUserParts ?? [])
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text"
        && typeof part.text === "string"
        && part.text.length > 0,
    )
    .map((part) => ({ type: "text" as const, text: part.text }))

  if (retryParts.length > 0) {
    return retryParts
  }

  return sessionID
    ? (getDelegatedChildSessionBootstrap(sessionID)?.retryParts ?? [])
    : []
}

import { extractSessionMessages } from "./session-messages"

export function getLastUserRetryParts(
  messagesResponse: unknown,
): Array<{ type: "text"; text: string }> {
  const messages = extractSessionMessages(messagesResponse)
  const lastUserMessage = messages?.filter((message) => message.info?.role === "user").pop()
  const lastUserParts =
    lastUserMessage?.parts
    ?? (lastUserMessage?.info?.parts as Array<{ type?: string; text?: string }> | undefined)

  return (lastUserParts ?? [])
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text"
        && typeof part.text === "string"
        && part.text.length > 0,
    )
    .map((part) => ({ type: "text" as const, text: part.text }))
}

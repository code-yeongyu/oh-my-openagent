type MessageItem = {
  info?: Record<string, unknown>
  parts?: Array<{ type?: string; text?: string }>
}

function extractMessages(messagesResponse: unknown): MessageItem[] | undefined {
  if (messagesResponse == null) return undefined
  if (Array.isArray(messagesResponse)) return messagesResponse as MessageItem[]
  if (typeof messagesResponse === "object") {
    const data = (messagesResponse as Record<string, unknown>).data
    if (Array.isArray(data)) return data as MessageItem[]
  }
  return undefined
}

export function getLastUserRetryParts(
  messagesResponse: unknown,
): Array<{ type: "text"; text: string }> {
  const messages = extractMessages(messagesResponse)
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

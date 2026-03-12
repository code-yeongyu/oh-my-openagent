export type SessionMessagePart = {
  type?: string
  text?: string
}

export type SessionMessage = {
  info?: Record<string, unknown>
  parts?: SessionMessagePart[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isSessionMessage(value: unknown): value is SessionMessage {
  return isRecord(value)
}

function isSessionMessageArray(value: unknown): value is SessionMessage[] {
  return Array.isArray(value) && value.every(isSessionMessage)
}

export function extractSessionMessages(messagesResponse: unknown): SessionMessage[] | undefined {
  if (isSessionMessageArray(messagesResponse)) {
    return messagesResponse
  }

  if (!isRecord(messagesResponse)) {
    return undefined
  }

  const data = messagesResponse.data
  if (isSessionMessageArray(data)) {
    return data
  }

  return undefined
}

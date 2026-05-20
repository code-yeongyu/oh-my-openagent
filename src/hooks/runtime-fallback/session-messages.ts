import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"

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
  const normalized = normalizeSDKResponse(messagesResponse, undefined as SessionMessage[] | undefined, {
    preferResponseOnMissingData: true,
  })

  if (isSessionMessageArray(normalized)) {
    return normalized
  }

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

  const messages = messagesResponse.messages
  if (isSessionMessageArray(messages)) {
    return messages
  }

  return undefined
}

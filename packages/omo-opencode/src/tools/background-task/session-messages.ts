import type { BackgroundOutputMessage, BackgroundOutputMessagesResult } from "./clients"

export function getErrorMessage(value: BackgroundOutputMessagesResult): string | null {
  if (Array.isArray(value)) return null
  if (value.error === undefined || value.error === null) return null
  if (typeof value.error === "string" && value.error.length > 0) return value.error
  return String(value.error)
}

function isSessionMessage(value: unknown): value is BackgroundOutputMessage {
  return typeof value === "object" && value !== null
}

export function extractMessages(value: BackgroundOutputMessagesResult): BackgroundOutputMessage[] {
  if (Array.isArray(value)) {
    return value.filter(isSessionMessage)
  }
  if (Array.isArray(value.data)) {
    return value.data.filter(isSessionMessage)
  }
  return []
}

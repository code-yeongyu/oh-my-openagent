import { resolveMessageEventSessionID } from "../../shared/event-session-id"

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined
}

function getStringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function hasCompletedTimeMarker(info: Record<string, unknown> | undefined): boolean {
  const time = asRecord(info?.time)
  const completed = time?.completed ?? info?.completed ?? info?.finished
  if (typeof completed === "number") {
    return Number.isFinite(completed)
  }
  if (typeof completed === "string") {
    return completed.length > 0
  }
  return completed === true
}

export function resolveResponseCompleteSessionID(properties: Record<string, unknown> | undefined): string | undefined {
  const info = asRecord(properties?.info)
  return resolveMessageEventSessionID(properties)
    ?? getStringField(properties, "sessionId")
    ?? getStringField(info, "sessionId")
}

export function resolveResponseMessageID(properties: Record<string, unknown> | undefined): string | undefined {
  return getStringField(asRecord(properties?.info), "id")
}

export function isAssistantResponseComplete(properties: Record<string, unknown> | undefined): boolean {
  const info = asRecord(properties?.info)
  if (getStringField(info, "role") !== "assistant") {
    return false
  }
  if (info && Object.hasOwn(info, "error")) {
    return false
  }
  if (hasCompletedTimeMarker(info)) {
    return true
  }

  const finish = info?.finish
  if (finish === true) {
    return true
  }
  if (typeof finish !== "string" || finish.length === 0) {
    return false
  }

  const normalizedFinish = finish.toLowerCase()
  return normalizedFinish !== "tool-calls"
    && normalizedFinish !== "tool_calls"
    && normalizedFinish !== "unknown"
}

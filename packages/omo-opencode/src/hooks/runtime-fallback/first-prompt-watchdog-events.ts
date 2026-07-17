import { isCompactionMessage } from "../../shared/compaction-marker"
import { resolveMessageEventSessionID, resolveSessionEventID } from "../../shared/event-session-id"
import { isAbortError } from "../../shared/is-abort-error"
import { isRecord } from "../../shared/record-type-guard"
import type { FirstPromptWatchdog } from "./first-prompt-watchdog"
import type { WatchdogEventDecision } from "./first-prompt-watchdog-types"
import { normalizeModelToCanonicalString } from "./normalize-model"

const TERMINAL_EVENT_TYPES = new Set([
  "session.idle",
  "session.stop",
  "session.deleted",
  "session.error",
])

function isCompletionMarker(value: unknown): boolean {
  if (typeof value === "boolean") return value
  return value !== undefined && value !== null
}

function hasAssistantCompletionMarker(info: Record<string, unknown>): boolean {
  const time = isRecord(info.time) ? info.time : undefined
  return isCompletionMarker(info.finish)
    || isCompletionMarker(info.finished)
    || isCompletionMarker(info.completed)
    || isCompletionMarker(time?.completed)
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.length > 0
}

function isSessionNextAssistantProgress(eventType: string, props: Record<string, unknown>): boolean {
  switch (eventType) {
    case "session.next.synthetic":
      return isNonEmptyString(props.text)
    case "session.next.text.delta":
    case "session.next.reasoning.delta":
    case "session.next.tool.input.delta":
      return isNonEmptyString(props.delta)
    case "session.next.text.ended":
    case "session.next.reasoning.ended":
    case "session.next.tool.input.ended":
      return isNonEmptyString(props.text)
    case "session.next.shell.started":
    case "session.next.shell.ended":
    case "session.next.step.ended":
    case "session.next.step.failed":
    case "session.next.tool.input.started":
    case "session.next.tool.called":
    case "session.next.tool.progress":
    case "session.next.tool.success":
    case "session.next.tool.failed":
      return true
    default:
      return false
  }
}

/** Translate an OpenCode event into a generation-aware watchdog signal. */
export function observeEventForWatchdog(
  event: { type: string; properties?: unknown },
  watchdog: FirstPromptWatchdog,
): WatchdogEventDecision | undefined {
  const props = isRecord(event.properties) ? event.properties : undefined
  if (!props) return

  if (isSessionNextAssistantProgress(event.type, props)) {
    const sessionID = resolveSessionEventID(props) ?? resolveMessageEventSessionID(props)
    if (sessionID) watchdog.onAssistantProgress(sessionID)
    return
  }

  if (event.type === "message.part.updated" || event.type === "message.part.delta") {
    const sessionID = resolveMessageEventSessionID(props)
    const part = isRecord(props.part) ? props.part : undefined
    const hasPartType = typeof part?.type === "string"
    const hasTopLevelType = typeof props.type === "string"
    const hasTextDelta = props.field === "text" && typeof props.delta === "string"
    const hasNonEmptySessionPart = typeof part?.sessionID === "string" && Object.keys(part).length > 0
    if (sessionID && (hasPartType || hasTopLevelType || hasTextDelta || hasNonEmptySessionPart)) {
      const messageID = typeof part?.messageID === "string" ? part.messageID : undefined
      watchdog.onAssistantProgress(sessionID, messageID)
    }
    return
  }

  if (event.type === "message.updated") {
    const info = isRecord(props.info) ? props.info : undefined
    if (!info) return
    const sessionID = typeof info.sessionID === "string" ? info.sessionID : undefined
    const role = typeof info.role === "string" ? info.role : undefined
    if (!sessionID || !role) return
    const eventParts = Array.isArray(props.parts) ? props.parts : undefined
    const infoParts = Array.isArray(info.parts) ? info.parts : undefined

    if (role === "user") {
      const model = normalizeModelToCanonicalString(info.model)
      const agent = typeof info.agent === "string" ? info.agent : undefined
      if (isCompactionMessage({ agent, parts: [...(eventParts ?? []), ...(infoParts ?? [])] })) return
      const messageID = typeof info.id === "string" ? info.id : undefined
      watchdog.onUserMessage(sessionID, model, agent, messageID)
      return
    }

    if (role === "assistant") {
      const hasError = info.error !== undefined
      const parts = [...(eventParts ?? []), ...(infoParts ?? [])]
      const hasAnyPart = parts.some((part) => isRecord(part) && typeof part.type === "string")
      if (hasError) {
        const parentMessageID = typeof info.parentID === "string" ? info.parentID : undefined
        return watchdog.onAssistantProgress(sessionID, parentMessageID, isAbortError(info.error))
      }
      if (hasAssistantCompletionMarker(info) || hasAnyPart) {
        return watchdog.onAssistantProgress(sessionID)
      }
    }
    return
  }

  if (!TERMINAL_EVENT_TYPES.has(event.type)) return
  const sessionID = resolveSessionEventID(props)
  if (!sessionID) return
  const abortEvent = event.type === "session.error" ? isAbortError(props.error) : undefined
  return watchdog.onSessionTerminal(sessionID, event.type, abortEvent)
}

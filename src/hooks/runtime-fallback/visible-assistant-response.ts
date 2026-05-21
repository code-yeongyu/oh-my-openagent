import type { HookDeps } from "./types"
import type { SessionMessage, SessionMessagePart } from "./session-messages"
import { extractSessionMessages } from "./session-messages"
import { extractAutoRetrySignal } from "./error-classifier"

const NON_TEXT_PROGRESS_PART_TYPES = new Set([
  "reasoning",
  "thinking",
  "tool",
  "tool_use",
  "tool_result",
  "tool-call",
  "step-start",
  "step-finish",
  "file",
])

type SessionMessageRecord = SessionMessage & Record<string, unknown>

function getMessageInfo(message: SessionMessage): Record<string, unknown> {
  const record = message as SessionMessageRecord
  const info = record.info
  return typeof info === "object" && info !== null ? info : {}
}

function getMessageRole(message: SessionMessage): string | undefined {
  const info = getMessageInfo(message)
  const record = message as SessionMessageRecord
  return typeof info.role === "string"
    ? info.role
    : typeof record.role === "string"
      ? record.role
      : undefined
}

function getMessageTime(message: SessionMessage): Record<string, unknown> {
  const info = getMessageInfo(message)
  const record = message as SessionMessageRecord
  const infoTime = info.time
  if (typeof infoTime === "object" && infoTime !== null) {
    return infoTime as Record<string, unknown>
  }

  const recordTime = record.time
  return typeof recordTime === "object" && recordTime !== null
    ? (recordTime as Record<string, unknown>)
    : {}
}

function getLastUserMessageIndex(messages: SessionMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index] && getMessageRole(messages[index]) === "user") {
      return index
    }
  }

  return -1
}

function isCompletionMarker(value: unknown): boolean {
  if (typeof value === "boolean") return value
  return value !== undefined && value !== null
}

function hasAssistantCompletionMarker(message: SessionMessage): boolean {
  const info = getMessageInfo(message)
  const completedAt = getMessageTime(message).completed

  return isCompletionMarker(info.finish)
    || isCompletionMarker(info.finished)
    || isCompletionMarker(info.completed)
    || isCompletionMarker(completedAt)
}

function getAssistantText(parts: SessionMessagePart[] | undefined): string {
  return (parts ?? [])
    .flatMap((part) => {
      if (part.type !== "text") {
        return []
      }

      const text = typeof part.text === "string" ? part.text.trim() : ""
      return text.length > 0 ? [text] : []
    })
    .join("\n")
}

function hasNonTextProgress(parts: SessionMessagePart[] | undefined): boolean {
  return (parts ?? []).some((part) => typeof part.type === "string" && NON_TEXT_PROGRESS_PART_TYPES.has(part.type))
}

function hasMeaningfulAssistantPayload(message: SessionMessage, parts: SessionMessagePart[] | undefined): boolean {
  const assistantText = getAssistantText(parts)
  if (assistantText.length > 0) {
    return true
  }

  if (hasNonTextProgress(parts)) {
    return true
  }

  const record = message as SessionMessageRecord
  const tokens = typeof record.tokens === "object" && record.tokens !== null
    ? (record.tokens as Record<string, unknown>)
    : {}
  const outputTokens = typeof tokens.output === "number" ? tokens.output : 0
  const reasoningTokens = typeof tokens.reasoning === "number" ? tokens.reasoning : 0
  const cost = typeof record.cost === "number" ? record.cost : 0

  return outputTokens > 0 || reasoningTokens > 0 || cost > 0
}

export function hasVisibleAssistantResponse(extractAutoRetrySignalFn: typeof extractAutoRetrySignal) {
  return async (
    ctx: HookDeps["ctx"],
    sessionID: string,
    _info: Record<string, unknown> | undefined,
  ): Promise<boolean> => {
    try {
      const messagesResponse = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      })
      const messages = extractSessionMessages(messagesResponse)
      if (!messages || messages.length === 0) return false

      const lastUserMessageIndex = getLastUserMessageIndex(messages)
      if (lastUserMessageIndex === -1) return false

      for (let index = lastUserMessageIndex + 1; index < messages.length; index++) {
        const message = messages[index]
        if (!message || getMessageRole(message) !== "assistant") {
          continue
        }

        const info = getMessageInfo(message)
        if (info.error) {
          continue
        }

        const infoParts = info.parts
        const infoMessageParts = Array.isArray(infoParts)
          ? infoParts.filter((part): part is SessionMessagePart => typeof part === "object" && part !== null)
          : undefined
        const parts = message.parts && message.parts.length > 0
          ? message.parts
          : infoMessageParts
        const assistantText = getAssistantText(parts)
        const hasCompletion = hasAssistantCompletionMarker(message)
        const hasProgress = hasNonTextProgress(parts)
        const autoRetrySignal = assistantText
          ? extractAutoRetrySignalFn({ message: assistantText })
          : undefined

        if (assistantText && !autoRetrySignal) {
          return true
        }

        if (!autoRetrySignal && ((hasCompletion && hasMeaningfulAssistantPayload(message, parts)) || hasProgress)) {
          return true
        }
      }

      return false
    } catch {
      return false
    }
  }
}

import type { SessionMessage } from "./executor-types"
import { isTerminalNoReplyUserMessage } from "../../shared"
import { extractErrorMessage } from "../../features/background-agent/error-classifier"

const NON_TERMINAL_FINISH_REASONS = new Set(["tool-calls", "unknown"])
const PENDING_TOOL_PART_TYPES = new Set(["tool", "tool_use", "tool-call"])
const ALL_BACKGROUND_TASKS_COMPLETE_MARKER = "[ALL BACKGROUND TASKS COMPLETE]"

type LastSessionTurns = {
  readonly lastAssistant: SessionMessage | undefined
  readonly lastRelevantUser: SessionMessage | undefined
}

function getTextParts(message: SessionMessage): string {
  return (message.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
}

function isInternalAllCompleteWake(message: SessionMessage): boolean {
  return isTerminalNoReplyUserMessage(message) && getTextParts(message).includes(ALL_BACKGROUND_TASKS_COMPLETE_MARKER)
}

function getLastSessionTurns(messages: readonly SessionMessage[]): LastSessionTurns {
  let lastRelevantUser: SessionMessage | undefined
  let lastAssistant: SessionMessage | undefined

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg === undefined) continue
    if (!lastAssistant && msg.info?.role === "assistant") lastAssistant = msg
    if (!lastRelevantUser && msg.info?.role === "user" && !isInternalAllCompleteWake(msg)) {
      lastRelevantUser = msg
    }
    if (lastRelevantUser && lastAssistant) break
  }

  return { lastAssistant, lastRelevantUser }
}

export function isSessionComplete(messages: readonly SessionMessage[]): boolean {
  const { lastAssistant, lastRelevantUser } = getLastSessionTurns(messages)

  if (!lastAssistant?.info?.finish) return false
  if (NON_TERMINAL_FINISH_REASONS.has(lastAssistant.info.finish)) return false
  if (lastAssistant.parts?.some((part) => part.type && PENDING_TOOL_PART_TYPES.has(part.type))) return false
  if (!lastRelevantUser?.info?.id || !lastAssistant?.info?.id) return false
  return lastRelevantUser.info.id < lastAssistant.info.id
}

export function getTerminalSessionError(messages: readonly SessionMessage[]): string | null {
  const { lastAssistant, lastRelevantUser } = getLastSessionTurns(messages)
  if (lastRelevantUser?.info?.id && lastAssistant?.info?.id && lastAssistant.info.id <= lastRelevantUser.info.id) {
    return null
  }
  if (!lastAssistant?.info || !("error" in lastAssistant.info)) {
    return null
  }

  const errorMessage = extractErrorMessage(lastAssistant.info.error)
  return errorMessage && errorMessage.length > 0 ? errorMessage : "Session error"
}

import type { SessionMessage } from "./executor-types"

const NON_TERMINAL_FINISH_REASONS = new Set(["tool-calls", "unknown"])
const PENDING_TOOL_PART_TYPES = new Set(["tool", "tool_use", "tool-call"])
const INTERNAL_INITIATOR_MARKER = "<!-- OMO_INTERNAL_INITIATOR -->"
const ALL_BACKGROUND_TASKS_COMPLETE_MARKER = "[ALL BACKGROUND TASKS COMPLETE]"

function getTextParts(message: SessionMessage): string {
  return (message.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
}

function isInternalAllCompleteWake(message: SessionMessage): boolean {
  if (message.info?.role !== "user") return false
  const text = getTextParts(message)
  return text.includes(INTERNAL_INITIATOR_MARKER) && text.includes(ALL_BACKGROUND_TASKS_COMPLETE_MARKER)
}

export function isSessionComplete(messages: SessionMessage[]): boolean {
  let lastRelevantUser: SessionMessage | undefined
  let lastAssistant: SessionMessage | undefined

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!lastAssistant && msg.info?.role === "assistant") lastAssistant = msg
    if (!lastRelevantUser && msg.info?.role === "user" && !isInternalAllCompleteWake(msg)) {
      lastRelevantUser = msg
    }
    if (lastRelevantUser && lastAssistant) break
  }

  if (!lastAssistant?.info?.finish) return false
  if (NON_TERMINAL_FINISH_REASONS.has(lastAssistant.info.finish)) return false
  if (lastAssistant.parts?.some((part) => part.type && PENDING_TOOL_PART_TYPES.has(part.type))) return false
  if (!lastRelevantUser?.info?.id || !lastAssistant?.info?.id) return false
  return lastRelevantUser.info.id < lastAssistant.info.id
}

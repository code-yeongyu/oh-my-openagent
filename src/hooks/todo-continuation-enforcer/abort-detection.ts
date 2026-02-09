import type { MessageInfo } from "./types"

export function isLastAssistantMessageAborted(
  messages: Array<{ info?: MessageInfo }>
): boolean {
  if (!messages || messages.length === 0) return false

  const assistantMessages = messages.filter((message) => message.info?.role === "assistant")
  if (assistantMessages.length === 0) return false

  const lastAssistant = assistantMessages[assistantMessages.length - 1]
  const errorName = lastAssistant.info?.error?.name

  if (!errorName) return false

  return errorName === "MessageAbortedError" || errorName === "AbortError"
}

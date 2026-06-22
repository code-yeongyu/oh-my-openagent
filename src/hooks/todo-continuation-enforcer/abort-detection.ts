import type { MessageInfo } from "./types"

export function isLastAssistantMessageAborted(
  messages: Array<{ info?: MessageInfo }>
): boolean {
  if (!messages || messages.length === 0) return false

  for (let i = messages.length - 1; i >= 0; i--) {
    const info = messages[i].info
    if (info?.role !== "assistant") continue

    const errorName = info.error?.name
    if (!errorName) return false
    return errorName === "MessageAbortedError" || errorName === "AbortError"
  }

  return false
}

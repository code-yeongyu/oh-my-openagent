import type { SessionMessage } from "./executor-types"

/**
 * The newest assistant text a child wrote, reasoning excluded. A child stopped at its turn cap is
 * usually mid tool call, so its last message may carry no text; the newest message that does is
 * the only report the caller can still receive (#9981).
 */
export function latestAssistantText(messages: readonly SessionMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.info?.role !== "assistant") continue
    const text = (message.parts ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("\n")
      .trim()
    if (text) return text
  }
  return undefined
}

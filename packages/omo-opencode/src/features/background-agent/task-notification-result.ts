import { log, messagesInDirectory, normalizeSDKResponse } from "../../shared"
import type { BackgroundTaskNotificationResult } from "./background-task-notification-template"
import type { OpencodeClient } from "./opencode-client"

/** Longest final answer a completion notice carries inline; past it the notice points at `background_output`. */
export const TASK_NOTIFICATION_RESULT_MAX_CHARS = 6000

/* The final answer is in the newest messages; reading the whole transcript of a long child would be wasted work. */
const RESULT_MESSAGE_WINDOW = 20

type ResultPart = { type?: string; text?: string; synthetic?: boolean }
type ResultMessage = { info?: { role?: string }; parts?: ResultPart[] }

/** The text of the newest assistant message that has any, without reasoning or synthetic parts. */
export function finalAssistantText(messages: readonly ResultMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.info?.role !== "assistant") continue
    const text = (message.parts ?? [])
      .filter((part) => part.type === "text" && !part.synthetic && part.text)
      .map((part) => part.text!.trim())
      .filter((part) => part.length > 0)
      .join("\n\n")
    if (text) return text
  }
  return undefined
}

export function capNotificationResult(
  text: string,
  maxChars = TASK_NOTIFICATION_RESULT_MAX_CHARS,
): BackgroundTaskNotificationResult {
  if (text.length <= maxChars) return { text, truncated: false }
  return {
    text: `${text.slice(0, maxChars).trimEnd()}\n[... ${text.length - maxChars} more characters]`,
    truncated: true,
  }
}

/** The child's final answer for its completion notice, or undefined when it cannot be read. */
export async function readTaskNotificationResult(
  client: OpencodeClient,
  sessionID: string,
  directory: string,
): Promise<BackgroundTaskNotificationResult | undefined> {
  try {
    const response = await messagesInDirectory(
      client,
      {
        path: { id: sessionID },
        query: { limit: RESULT_MESSAGE_WINDOW },
      },
      directory,
    )
    const messages = normalizeSDKResponse(response, [] as ResultMessage[], { preferResponseOnMissingData: true })
    const text = finalAssistantText(Array.isArray(messages) ? messages : [])
    return text === undefined ? undefined : capNotificationResult(text)
  } catch (error) {
    log("[background-agent] Could not read the child's final answer for its notification:", {
      sessionID,
      error: String(error),
    })
    return undefined
  }
}

import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"
import { withTimeout } from "./with-timeout"

interface OpenCodeSessionMessage {
  info?: { role?: string }
  parts?: Array<{ type: string; text?: string }>
}

const COMPLETION_PATTERNS = [
  /\ball\s+(?:tasks?|todos?|items?)\s+(?:are\s+)?(?:completed?|done|finished)\b/i,
  /\btask\s+(?:is\s+)?(?:completed?|done|finished)\b/i,
  /\bwork\s+(?:is\s+)?(?:completed?|done|finished)\b/i,
  /\bimplementation\s+(?:is\s+)?(?:completed?|done|finished)\b/i,
  /\beverything\s+(?:is\s+)?(?:completed?|done|finished)\b/i,
  /\bsuccessfully\s+completed\b/i,
  /\bnothing\s+(?:left|remaining|more)\s+to\s+do\b/i,
  /\bcompleted?\s+all\s+(?:tasks?|todos?|items?|steps?)\b/i,
  /任务[已都全]完成/,
  /[已都全]完成[了啦]?[。！!]?\s*$/,
  /规划[已都]完成/,
  /工作[已都]完成/,
  /所有.*(?:完成|结束)/,
]

function extractLastAssistantText(messages: OpenCodeSessionMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (msg.info?.role !== "assistant") continue
    if (!msg.parts) continue

    const hasToolCalls = msg.parts.some((p) => p.type === "tool")
    if (hasToolCalls) return null

    let text = ""
    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        text += part.text
      }
    }

    return text.trim() || null
  }

  return null
}

function countRecentCompletionMessages(messages: OpenCodeSessionMessage[], limit: number): number {
  let count = 0
  let checked = 0

  for (let i = messages.length - 1; i >= 0 && checked < limit; i -= 1) {
    const msg = messages[i]
    if (msg.info?.role !== "assistant") continue
    checked += 1

    if (!msg.parts) continue
    const hasToolCalls = msg.parts.some((p) => p.type === "tool")
    if (hasToolCalls) break

    let text = ""
    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        text += part.text
      }
    }

    if (COMPLETION_PATTERNS.some((pattern) => pattern.test(text))) {
      count += 1
    } else {
      break
    }
  }

  return count
}

export async function detectSemanticCompletion(
  ctx: PluginInput,
  options: {
    sessionID: string
    apiTimeoutMs: number
    directory: string
    sinceMessageIndex?: number
  },
): Promise<boolean> {
  try {
    const response = await withTimeout(
      ctx.client.session.messages({
        path: { id: options.sessionID },
        query: { directory: options.directory },
      }),
      options.apiTimeoutMs,
    )

    const messagesResponse: unknown = response
    const responseData =
      typeof messagesResponse === "object" && messagesResponse !== null && "data" in messagesResponse
        ? (messagesResponse as { data?: unknown }).data
        : undefined

    const messageArray: unknown[] = Array.isArray(messagesResponse)
      ? messagesResponse
      : Array.isArray(responseData)
        ? responseData
        : []

    const scopedMessages =
      typeof options.sinceMessageIndex === "number" && options.sinceMessageIndex >= 0 && options.sinceMessageIndex < messageArray.length
        ? messageArray.slice(options.sinceMessageIndex)
        : messageArray

    const messages = scopedMessages as OpenCodeSessionMessage[]
    const lastText = extractLastAssistantText(messages)
    if (!lastText) return false

    const matchesCompletionPattern = COMPLETION_PATTERNS.some((pattern) => pattern.test(lastText))
    if (!matchesCompletionPattern) return false

    const repeatedCompletionCount = countRecentCompletionMessages(messages, 3)
    if (repeatedCompletionCount >= 2) {
      log(`[${HOOK_NAME}] Semantic completion detected (repeated ${repeatedCompletionCount}x)`, {
        sessionID: options.sessionID,
        lastText: lastText.slice(0, 200),
      })
      return true
    }

    return false
  } catch (err) {
    log(`[${HOOK_NAME}] Semantic completion check failed`, {
      sessionID: options.sessionID,
      error: String(err),
    })
    return false
  }
}

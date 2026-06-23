import { createFragmentTracker } from "./fragment-tracker"
import {
  extractTerminalStatus,
  safeParseFrame,
  type DeepSeekFrame,
} from "./openai-sse-frame-helpers"

export type SseBodySignals = {
  sse_data_count: number
  sse_event_count: number
  empty_sse: boolean
  terminal_status: string | null
  content_text: string
  reasoning_text: string
  response_message_id: number | null
}

const LEGACY_CONTENT_PATH = "response/content"

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x)
}

function resolveFeedPath(parsed: DeepSeekFrame, currentPath: string): string {
  if (currentPath !== "") return currentPath
  if (typeof parsed.p === "string") return parsed.p
  if (typeof parsed.v === "string") return LEGACY_CONTENT_PATH
  return currentPath
}

function readResponseMessageId(parsed: DeepSeekFrame): number | null {
  if (typeof (parsed as { response_message_id?: unknown }).response_message_id === "number") {
    return (parsed as { response_message_id: number }).response_message_id
  }
  if (isObject(parsed.v) && isObject(parsed.v.response)) {
    const id = parsed.v.response.message_id
    if (typeof id === "number") return id
  }
  return null
}

export function extractSseBodySignals(body: string): SseBodySignals {
  if (!body || body.length === 0) {
    return {
      sse_data_count: 0,
      sse_event_count: 0,
      empty_sse: true,
      terminal_status: null,
      content_text: "",
      reasoning_text: "",
      response_message_id: null,
    }
  }
  const tracker = createFragmentTracker()
  const lines = body.split(/\r?\n/)
  let dataCount = 0
  let eventCount = 0
  let contentText = ""
  let reasoningText = ""
  let terminal: string | null = null
  let responseMessageId: number | null = null
  let currentPath = ""
  for (const rawLine of lines) {
    if (rawLine.startsWith("event:")) {
      eventCount++
      continue
    }
    if (!rawLine.startsWith("data:")) continue
    dataCount++
    const payload = rawLine.slice(5).trim()
    if (payload.length === 0 || payload === "[DONE]") continue
    const parsed = safeParseFrame(payload)
    if (!parsed) continue
    if (typeof parsed.p === "string") currentPath = parsed.p
    const feedPath = resolveFeedPath(parsed, currentPath)
    for (const ev of tracker.feed(parsed, feedPath)) {
      if (!ev) continue
      if (ev.kind === "reasoning") reasoningText += ev.text
      else contentText += ev.text
    }
    const status = extractTerminalStatus(parsed)
    if (status !== null) terminal = status
    const msgId = readResponseMessageId(parsed)
    if (msgId !== null) responseMessageId = msgId
  }
  return {
    sse_data_count: dataCount,
    sse_event_count: eventCount,
    empty_sse: dataCount === 0 && eventCount === 0,
    terminal_status: terminal,
    content_text: contentText,
    reasoning_text: reasoningText,
    response_message_id: responseMessageId,
  }
}

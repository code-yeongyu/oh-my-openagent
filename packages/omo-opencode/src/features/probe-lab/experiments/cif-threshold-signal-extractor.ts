export type CifSseSignals = {
  sse_event_count: number
  data_chunk_count: number
  content_text: string
  token_usage: number | null
  terminal_status: string | null
  response_message_id: number | null
  empty_sse: boolean
  ttft_marker_seen: boolean
}

const TOKEN_USAGE_PATH = "response/accumulated_token_usage"
const STATUS_PATH = "response/status"

export function extractCifSseSignals(body: string): CifSseSignals {
  if (!body || body.length === 0) {
    return { sse_event_count: 0, data_chunk_count: 0, content_text: "", token_usage: null, terminal_status: null, response_message_id: null, empty_sse: true, ttft_marker_seen: false }
  }
  const lines = body.split(/\r?\n/)
  let eventCount = 0
  let dataCount = 0
  let contentText = ""
  let tokenUsage: number | null = null
  let terminalStatus: string | null = null
  let responseMessageId: number | null = null
  let readySeen = false
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventCount++
      if (line.includes("ready")) readySeen = true
      continue
    }
    if (!line.startsWith("data:")) continue
    dataCount++
    const payload = line.slice(5).trim()
    if (payload.length === 0 || payload === "[DONE]") continue
    const parsed = safeParseJson(payload)
    if (parsed == null) continue
    const chunk = extractContentChunk(parsed)
    if (chunk != null) contentText += chunk
    const tu = extractTokenUsage(parsed)
    if (tu != null) tokenUsage = tu
    const st = extractStatus(parsed)
    if (st != null) terminalStatus = st
    const messageId = extractResponseMessageId(parsed)
    if (messageId != null) responseMessageId = messageId
  }
  return {
    sse_event_count: eventCount,
    data_chunk_count: dataCount,
    content_text: contentText,
    token_usage: tokenUsage,
    terminal_status: terminalStatus,
    response_message_id: responseMessageId,
    empty_sse: dataCount === 0 && eventCount === 0,
    ttft_marker_seen: readySeen || dataCount > 0,
  }
}

function safeParseJson(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return null }
}

function extractContentChunk(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  if (payload.p === "response/content" && typeof payload.v === "string") return payload.v
  if ("v" in payload && typeof payload.v === "string" && !("p" in payload)) return payload.v
  return null
}

function extractTokenUsage(payload: unknown): number | null {
  if (!isRecord(payload)) return null
  if (payload.p === TOKEN_USAGE_PATH && typeof payload.v === "number") return payload.v
  return null
}

function extractStatus(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  if (payload.p === STATUS_PATH && typeof payload.v === "string") return payload.v
  if (isRecord(payload.v) && isRecord(payload.v.response) && typeof payload.v.response.status === "string") {
    return payload.v.response.status
  }
  return null
}

function extractResponseMessageId(payload: unknown): number | null {
  if (!isRecord(payload)) return null
  if (typeof payload.response_message_id === "number") return payload.response_message_id
  if (isRecord(payload.v) && isRecord(payload.v.response) && typeof payload.v.response.message_id === "number") {
    return payload.v.response.message_id
  }
  return null
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null
}

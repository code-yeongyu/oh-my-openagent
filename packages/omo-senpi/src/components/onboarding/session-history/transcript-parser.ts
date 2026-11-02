import { canonicalCodexResponseUserIndices, extractText } from "./codex-canonical-turns"
import { MAX_IMPORTED_MESSAGES, MAX_IMPORT_RECORDS } from "./constants"
import { decodeTranscriptLine, type TranscriptRecord } from "./transcript-records"
import type { AgentSessionSource, AgentSessionThread, AgentSessionThreadMessage } from "./types"

export interface TranscriptMetadata {
  readonly source: AgentSessionSource
  readonly fallbackSessionId: string
  readonly lastActiveAtMs: number
}

type RetainedMessage = AgentSessionThreadMessage & { readonly codexResponseUser: boolean }

function normalizeTimestamp(value: string | undefined, fallback: string): string {
  if (value === undefined) return fallback
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString()
}

function splitTranscriptRecords(contents: string, limit: number): Array<string> {
  const records = contents.endsWith("\n") ? contents.slice(0, -1) : contents
  return records.split("\n", limit)
}

/** Keep visible user and assistant text while ignoring tools, reasoning, and malformed records. */
export function parseAgentSessionTranscript(input: TranscriptMetadata & { readonly contents: string }): AgentSessionThread | null {
  const lines = splitTranscriptRecords(input.contents, MAX_IMPORT_RECORDS + 1)
  if (lines.length > MAX_IMPORT_RECORDS) return null
  const records = lines.flatMap((line) => decodeTranscriptLine(line, input.source) ?? [])
  return parseAgentSessionRecords(input, records)
}

class MessageWindow {
  readonly messages: Array<RetainedMessage> = []
  first: RetainedMessage | undefined

  retain(message: RetainedMessage): void {
    if (this.first === undefined && message.role === "user") this.first = message
    this.messages.push(message)
    if (this.messages.length > MAX_IMPORTED_MESSAGES) this.messages.shift()
  }

  /** Codex writes one prompt as both a response item and an event; drop only the matching response copy. */
  dropResponseCopy(text: string): void {
    for (let index = this.messages.length - 1; index >= 0; index--) {
      const message = this.messages[index]
      if (message?.role === "assistant") return
      if (message?.codexResponseUser === true && message.text.trim() === text.trim()) {
        if (this.first === message) this.first = undefined
        this.messages.splice(index, 1)
        return
      }
    }
  }

  hasMatchingEventInTurn(text: string): boolean {
    const comparison = text.trim()
    for (let index = this.messages.length - 1; index >= 0; index--) {
      const message = this.messages[index]
      if (message?.role === "assistant") return false
      if (message?.role === "user" && !message.codexResponseUser && message.text.trim() === comparison) return true
    }
    return false
  }
}

export function parseAgentSessionRecords(input: TranscriptMetadata, records: ReadonlyArray<TranscriptRecord>): AgentSessionThread | null {
  const fallbackTimestamp = new Date(input.lastActiveAtMs).toISOString()
  // Claude filenames are session ids; Codex rollout names are not, so only metadata can supply one.
  let providerSessionId = input.source === "codex" ? "" : input.fallbackSessionId
  let title: string | null = null
  let model: string | null = null
  let hasCodexSessionId = false
  const window = new MessageWindow()
  const canonical = input.source === "codex" ? canonicalCodexResponseUserIndices(records) : new Set<number>()
  const createdAt = (record: TranscriptRecord) => normalizeTimestamp(record.timestamp, fallbackTimestamp)

  records.forEach((record, recordIndex) => {
    if (input.source === "claudeAgent") {
      if (record.isSidechain === true || record.isMeta === true || record.isCompactSummary === true) return
      if (record.sessionId?.trim()) providerSessionId = record.sessionId.trim()
      if (record.aiTitle?.trim()) title = record.aiTitle.trim()
      const messageModel = record.message?.model?.trim()
      // Claude uses `<synthetic>` for local error responses; it is not a resumable model id.
      if (messageModel && messageModel !== "<synthetic>") model = messageModel
      if (record.type !== "user" && record.type !== "assistant") return
      const text = extractText(record.message?.content)
      if (text.length > 0) window.retain({ role: record.type, text, createdAt: createdAt(record), codexResponseUser: false })
      return
    }
    const payload = record.payload
    if (record.type === "session_meta") {
      const sessionId = payload?.id?.trim() || payload?.session_id?.trim()
      if (!hasCodexSessionId && sessionId) {
        providerSessionId = sessionId
        hasCodexSessionId = true
      }
      return
    }
    if (record.type === "turn_context" && payload?.model?.trim()) {
      model = payload.model.trim()
      return
    }
    if (record.type === "event_msg" && payload?.type === "user_message") {
      const text = payload.message ?? ""
      if (text.trim().length === 0) return
      window.dropResponseCopy(text)
      window.retain({ role: "user", text, createdAt: createdAt(record), codexResponseUser: false })
      return
    }
    if (record.type !== "response_item" || payload?.type !== "message") return
    const role = payload.role
    if (role !== "user" && role !== "assistant") return
    const text = extractText(payload.content)
    if (text.length === 0) return
    if (role === "user" && (canonical.has(recordIndex) || window.hasMatchingEventInTurn(text))) return
    window.retain({ role, text, createdAt: createdAt(record), codexResponseUser: role === "user" })
  })

  const first = window.first
  if (providerSessionId.trim().length === 0 || first === undefined) return null
  const visible = window.messages.map(({ codexResponseUser: _, ...message }) => message)
  const { codexResponseUser: _first, ...visibleFirst } = first
  const retained = window.messages.includes(first) ? visible : [visibleFirst, ...visible.slice(-(MAX_IMPORTED_MESSAGES - 1))]
  const derivedTitle = visibleFirst.text.trim().split("\n")[0]?.slice(0, 100).trim()
  return {
    source: input.source,
    providerSessionId,
    title: title ?? (derivedTitle && derivedTitle.length > 0 ? derivedTitle : "Imported thread"),
    model,
    createdAt: retained[0]?.createdAt ?? fallbackTimestamp,
    updatedAt: fallbackTimestamp,
    messages: retained,
  }
}

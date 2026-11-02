import type { FactsPayload } from "../facts/extraction"
import { AGREEMENT_TEXT_MAX_CHARS, type AgreementExtractionRecord, type AgreementSourceEvent } from "./types"

export class AgreementRecordValidationError extends Error {
  override readonly name = "AgreementRecordValidationError"
}

export function parseAgreementRecord(value: unknown, index: number): AgreementExtractionRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid(index, "record must be an object")
  const record: Record<string, unknown> = { ...value }
  const date = validDate(record.date)
  if (date === undefined) throw invalid(index, "date must be YYYY-MM-DD")
  const source = record.source === undefined ? undefined : parseSource(record.source, index)
  const withSource = source === undefined ? {} : { source }
  if (record.action === "new") {
    assertKeys(record, ["action", "applies", "text", "date", "source"], index)
    const text = boundedText(record.text, index)
    if (text === undefined) throw invalid(index, "text must be non-empty")
    if (record.applies !== "global" && record.applies !== "project") throw invalid(index, "applies must be global or project")
    return { action: "new", applies: record.applies, text, date, ...withSource }
  }
  if (record.action !== "reaffirm") throw invalid(index, "action must be new or reaffirm")
  assertKeys(record, ["action", "id", "date", "text", "source"], index)
  if (typeof record.id !== "string" || !/^[0-9a-f]{10}$/.test(record.id)) throw invalid(index, "id must name an existing agreement")
  const text = record.text === undefined ? undefined : boundedText(record.text, index)
  return { action: "reaffirm", id: record.id, date, ...(text === undefined ? {} : { text }), ...withSource }
}

export function validateAgreementSource(record: AgreementExtractionRecord, payload: FactsPayload, index = 0): void {
  if (record.source === undefined) {
    if (payload.agreementEventVersion !== undefined) throw invalid(index, "source user-message identity is required")
    return
  }
  const source = record.source
  if (!payload.entries.some((entry) => entry.sessionId === source.sessionId
    && entry.entries.some((message) => message.kind === "user" && message.source_message_id === source.messageId))) {
    throw invalid(index, "source must identify a user message in the extraction payload, not lead context")
  }
}

function parseSource(value: unknown, index: number): AgreementSourceEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid(index, "source must be an object")
  const source: Record<string, unknown> = { ...value }
  assertKeys(source, ["sessionId", "messageId"], index)
  if (typeof source.sessionId !== "string" || source.sessionId.trim().length === 0
    || typeof source.messageId !== "string" || source.messageId.trim().length === 0) {
    throw invalid(index, "source requires non-empty sessionId and messageId")
  }
  return { sessionId: source.sessionId, messageId: source.messageId }
}

export function parseAgreementRecordsJsonl(raw: string): AgreementExtractionRecord[] {
  const records: AgreementExtractionRecord[] = []
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw invalid(index, "line is not valid JSON")
    }
    records.push(parseAgreementRecord(value, index))
  }
  return records
}

export function cleanAgreementText(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

export function agreementTextProblem(text: string): string | undefined {
  if (text.length === 0) return "text must be non-empty"
  if (text.includes("<!--") || text.includes("-->")) return "text must not contain HTML comment markers"
  if (text.length > AGREEMENT_TEXT_MAX_CHARS) return `text must be at most ${AGREEMENT_TEXT_MAX_CHARS} characters`
  return undefined
}

function boundedText(value: unknown, index: number): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined
  const text = cleanAgreementText(value)
  const problem = agreementTextProblem(text)
  if (problem !== undefined) throw invalid(index, problem)
  return text
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], index: number): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key))
  if (extra !== undefined) throw invalid(index, `unexpected field: ${extra}`)
}

function validDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value ? value : undefined
}

function invalid(index: number, message: string): AgreementRecordValidationError {
  return new AgreementRecordValidationError(`agreement record ${index + 1}: ${message}`)
}

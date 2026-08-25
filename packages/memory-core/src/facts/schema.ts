// Facts queue wire format (IC-6). The queue is durable, versioned, and read by a
// crash-recovering process that never saw the producer, so every shape here is
// validated fail-closed on read.

import { createHash } from "node:crypto"
import { join } from "node:path"

import type { MemoryIdentityPaths } from "../identity"
import { isCanonicalEntry, type TranscriptEntry } from "../journal"

export const FACTS_QUEUE_VERSION = 1 as const

/** Real reflection-cursor fields; ranges are positional, ids are opaque. */
export interface FactsQueueRange {
  readonly start_message_id: string
  readonly end_message_id: string
  readonly start_line: number
  readonly end_snapshot_line: number
}

export interface FactsQueueEntry {
  readonly version: typeof FACTS_QUEUE_VERSION
  readonly identity: string
  readonly sessionId: string
  readonly conversationId: string
  readonly range: FactsQueueRange
  readonly enqueuedAt: string
  readonly entries: readonly TranscriptEntry[]
}

/**
 * Per-conversation facts cursor. Two watermarks with distinct semantics:
 * `enqueued_through_message_id` is MONOTONIC over durably queued endpoints and never
 * regresses; `consumed_through_message_id` advances only after verified application.
 *
 * Each endpoint is stored with the `end_snapshot_line` of the batch that produced it.
 * Message ids are opaque, and a late older batch's own entry list does NOT contain a
 * newer batch's endpoint, so the two endpoints cannot be ordered positionally against
 * either batch alone. The snapshot boundary is the journal length at publication time,
 * which IS comparable across batches, so it is the ordering frame for both watermarks.
 */
export interface FactsCursor {
  readonly version: typeof FACTS_QUEUE_VERSION
  readonly enqueued_through_message_id: string | null
  readonly enqueued_through_snapshot_line: number
  readonly consumed_through_message_id: string | null
  readonly consumed_through_snapshot_line: number
}

export interface FactsConsumedRecord {
  readonly end_message_id: string
  readonly end_snapshot_line: number
  readonly consumedAt: string
}

export interface FactsConsumedWatermark {
  readonly version: typeof FACTS_QUEUE_VERSION
  readonly consumed: Readonly<Record<string, FactsConsumedRecord>>
}

export interface FactsQueueLayout {
  readonly queueDir: string
  readonly cursorDir: string
  readonly consumedPath: string
  readonly failuresPath: string
  cursorPath(conversationId: string): string
  entryPath(conversationId: string, endMessageId: string, at: Date): string
}

function hash(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length)
}

/**
 * Colon-free UTC stamp (`YYYYMMDDTHHMMSSmmmZ`): `Date.toISOString()` colons are
 * illegal in Windows filenames and this repo builds on windows-latest.
 */
export function queueTimestamp(at: Date): string {
  return at.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".", "")
}

export function factsQueuePaths(identityPaths: MemoryIdentityPaths): FactsQueueLayout {
  const queueDir = identityPaths.factsQueue
  const cursorDir = join(queueDir, "cursor")
  return {
    queueDir,
    cursorDir,
    consumedPath: join(queueDir, "consumed.json"),
    failuresPath: join(queueDir, "failures.json"),
    cursorPath: (conversationId) => join(cursorDir, `${hash(conversationId, 12)}.json`),
    entryPath: (conversationId, endMessageId, at) =>
      join(queueDir, `${queueTimestamp(at)}-${hash(conversationId, 12)}-${hash(endMessageId, 8)}.json`),
  }
}

export function initialCursor(): FactsCursor {
  return {
    version: FACTS_QUEUE_VERSION,
    enqueued_through_message_id: null,
    enqueued_through_snapshot_line: -1,
    consumed_through_message_id: null,
    consumed_through_snapshot_line: -1,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined
}

function parseRange(value: unknown): FactsQueueRange | undefined {
  if (!isRecord(value)) return undefined
  const start = nonEmptyString(value.start_message_id)
  const end = nonEmptyString(value.end_message_id)
  const startLine = nonNegativeInteger(value.start_line)
  const endLine = nonNegativeInteger(value.end_snapshot_line)
  if (start === undefined || end === undefined || startLine === undefined || endLine === undefined) {
    return undefined
  }
  return { start_message_id: start, end_message_id: end, start_line: startLine, end_snapshot_line: endLine }
}

/** Fail-closed queue-file validation, mirroring the journal store's row discipline. */
export function parseQueueEntry(raw: string): FactsQueueEntry | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || parsed.version !== FACTS_QUEUE_VERSION) return undefined
  const identity = nonEmptyString(parsed.identity)
  const sessionId = nonEmptyString(parsed.sessionId)
  const conversationId = nonEmptyString(parsed.conversationId)
  const enqueuedAt = nonEmptyString(parsed.enqueuedAt)
  const range = parseRange(parsed.range)
  if (
    identity === undefined ||
    sessionId === undefined ||
    conversationId === undefined ||
    enqueuedAt === undefined ||
    range === undefined ||
    !Array.isArray(parsed.entries)
  ) {
    return undefined
  }
  const entries = parsed.entries.filter((row): row is TranscriptEntry => isTranscriptEntry(row))
  if (entries.length !== parsed.entries.length) return undefined
  return { version: FACTS_QUEUE_VERSION, identity, sessionId, conversationId, range, enqueuedAt, entries }
}

function isTranscriptEntry(value: unknown): value is TranscriptEntry {
  if (!isRecord(value)) return false
  if (
    typeof value.kind !== "string" ||
    typeof value.captured_at !== "string" ||
    typeof value.source_line_id !== "string" ||
    typeof value.source_message_id !== "string"
  ) {
    return false
  }
  if (value.kind === "tool_call") return true
  return (
    (value.kind === "user" ||
      value.kind === "assistant" ||
      value.kind === "reasoning" ||
      value.kind === "error") &&
    typeof value.text === "string"
  )
}

export function parseCursor(raw: string): FactsCursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return initialCursor()
  }
  if (!isRecord(parsed) || parsed.version !== FACTS_QUEUE_VERSION) return initialCursor()
  return {
    version: FACTS_QUEUE_VERSION,
    enqueued_through_message_id: nullableString(parsed.enqueued_through_message_id),
    enqueued_through_snapshot_line: nonNegativeInteger(parsed.enqueued_through_snapshot_line) ?? -1,
    consumed_through_message_id: nullableString(parsed.consumed_through_message_id),
    consumed_through_snapshot_line: nonNegativeInteger(parsed.consumed_through_snapshot_line) ?? -1,
  }
}

export function parseConsumed(raw: string): FactsConsumedWatermark {
  const empty: FactsConsumedWatermark = { version: FACTS_QUEUE_VERSION, consumed: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return empty
  }
  if (!isRecord(parsed) || parsed.version !== FACTS_QUEUE_VERSION || !isRecord(parsed.consumed)) {
    return empty
  }
  const consumed: Record<string, FactsConsumedRecord> = {}
  for (const [conversationId, value] of Object.entries(parsed.consumed)) {
    if (!isRecord(value)) continue
    const endMessageId = nonEmptyString(value.end_message_id)
    const consumedAt = nonEmptyString(value.consumedAt)
    if (endMessageId === undefined || consumedAt === undefined) continue
    consumed[conversationId] = {
      end_message_id: endMessageId,
      end_snapshot_line: nonNegativeInteger(value.end_snapshot_line) ?? -1,
      consumedAt,
    }
  }
  return { version: FACTS_QUEUE_VERSION, consumed }
}

/**
 * Positional index of a message id among CANONICAL entries, exactly as
 * `captureCursorSnapshot` derives ranges. Message ids are opaque and carry no
 * lexical ordering, so every watermark comparison goes through this function.
 */
export function canonicalPosition(
  entries: readonly TranscriptEntry[],
  messageId: string | null,
): number {
  if (messageId === null) return -1
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry && isCanonicalEntry(entry) && entry.source_message_id === messageId) return index
  }
  return -1
}

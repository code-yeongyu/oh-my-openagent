import { Buffer } from "node:buffer"
import type { TranscriptEntry } from "./entries"

export const REFLECTION_STATE_SCHEMA_VERSION = "v3_assistant_steps" as const

/**
 * Upper bound on the serialized bytes a single reflection payload may carry. The backlog grows
 * without bound whenever reflection fails (the cursor intentionally stays put), so an unbounded
 * payload replays an ever larger transcript into a fixed context window. Capture ships the OLDEST
 * window that fits and leaves the rest for the next run.
 */
export const REFLECTION_SNAPSHOT_MAX_BYTES = 131_072

export type ReflectionTranscriptState = {
  readonly schema_version: typeof REFLECTION_STATE_SCHEMA_VERSION
  readonly reflected_through_message_id?: string
  readonly reflected_through_byte_offset?: number
  readonly total_completed_steps: number
  readonly reflected_completed_steps: number
  readonly steps_since_last_successful_reflection: number
  readonly last_reflection_started_at?: string
  readonly last_reflection_succeeded_at?: string
  readonly pending_compaction?: boolean
  /** Derived: serialized bytes of the entries after the reflected cursor. */
  readonly unreflected_bytes?: number
}

export type ReflectionSnapshot = {
  readonly start_message_id: string
  readonly end_message_id: string
  readonly start_line: number
  readonly end_snapshot_line: number
  readonly entries: readonly TranscriptEntry[]
  /** Entries left after `end_snapshot_line`, i.e. the backlog a later run still has to cover. */
  readonly backlog_remaining?: number
}

export type CaptureCursorOptions = {
  readonly maxBytes?: number
}

function entryBytes(entry: TranscriptEntry): number {
  return Buffer.byteLength(`${JSON.stringify(entry)}\n`, "utf8")
}

/**
 * Index of the last row belonging to the reflected message, so a resumed capture starts after the
 * WHOLE message group (its trailing tool rows included) rather than replaying them.
 */
function anchorRowIndex(
  entries: readonly TranscriptEntry[],
  reflectedThroughMessageId: string | undefined,
): number {
  if (reflectedThroughMessageId === undefined) return -1
  let anchor = -1
  for (const [index, entry] of entries.entries()) {
    if (entry.source_message_id === reflectedThroughMessageId) anchor = index
  }
  return anchor
}

export function isCanonicalEntry(
  entry: TranscriptEntry,
): entry is TranscriptEntry & { readonly kind: "user" | "assistant" } {
  return (
    (entry.kind === "user" || entry.kind === "assistant") &&
    entry.source_message_id.length > 0 &&
    entry.text.trim().length > 0
  )
}

export function countCompletedSteps(entries: readonly TranscriptEntry[]): number {
  return entries.filter(
    (entry) =>
      entry.kind === "assistant" &&
      entry.source_message_id.length > 0 &&
      entry.text.trim().length > 0,
  ).length
}

export function deriveState(
  state: ReflectionTranscriptState,
  entries: readonly TranscriptEntry[],
): ReflectionTranscriptState {
  const totalCompletedSteps = countCompletedSteps(entries)
  const reflectedCompletedSteps = Math.min(
    Math.max(0, Math.trunc(state.reflected_completed_steps)),
    totalCompletedSteps,
  )
  const anchorIndex = anchorRowIndex(entries, state.reflected_through_message_id)
  return {
    ...state,
    schema_version: REFLECTION_STATE_SCHEMA_VERSION,
    total_completed_steps: totalCompletedSteps,
    reflected_completed_steps: reflectedCompletedSteps,
    steps_since_last_successful_reflection: Math.max(
      0,
      totalCompletedSteps - reflectedCompletedSteps,
    ),
    unreflected_bytes: entries
      .slice(anchorIndex + 1)
      .reduce((total, entry) => total + entryBytes(entry), 0),
  }
}

export function captureCursorSnapshot(
  entries: readonly TranscriptEntry[],
  state: ReflectionTranscriptState,
  options: CaptureCursorOptions = {},
): ReflectionSnapshot | null {
  const anchorIndex = anchorRowIndex(entries, state.reflected_through_message_id)
  const startIndex = entries.findIndex(
    (entry, index) => index > anchorIndex && isCanonicalEntry(entry),
  )
  if (startIndex < 0) return null
  const start = entries[startIndex]
  if (!start || !isCanonicalEntry(start)) return null

  const maxBytes = options.maxBytes ?? REFLECTION_SNAPSHOT_MAX_BYTES
  const windowStart = anchorIndex + 1
  let bytes = entries.slice(windowStart, startIndex).reduce((total, entry) => total + entryBytes(entry), 0)
  let endMessageId: string | undefined
  let endLine = -1
  let budgetExhausted = false

  for (let index = startIndex; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) break
    bytes += entryBytes(entry)
    if (!isCanonicalEntry(entry)) continue
    // A canonical row closes at the last contiguous row sharing its message id, so the payload
    // never ends mid-message.
    let groupEnd = index
    let groupBytes = bytes
    for (let next = index + 1; next < entries.length; next += 1) {
      const trailing = entries[next]
      if (!trailing || trailing.source_message_id !== entry.source_message_id) break
      groupEnd = next
      groupBytes += entryBytes(trailing)
    }
    // Progress guarantee: the first group always ships, even when it alone busts the budget.
    if (groupBytes > maxBytes && endMessageId !== undefined) {
      budgetExhausted = true
      break
    }
    endMessageId = entry.source_message_id
    endLine = groupEnd + 1
    bytes = groupBytes
    index = groupEnd
    if (groupBytes >= maxBytes) {
      budgetExhausted = true
      break
    }
  }

  if (endMessageId === undefined || endLine < 0) return null
  // Rows after the last canonical message (a tool-only tail) belong to this window when the
  // whole backlog fit: leaving them behind would strand them until a later canonical row arrives.
  if (!budgetExhausted && bytes <= maxBytes) endLine = entries.length

  const backlogRemaining = entries.length - endLine
  return {
    start_message_id: start.source_message_id,
    end_message_id: endMessageId,
    start_line: windowStart,
    end_snapshot_line: endLine,
    entries: entries.slice(windowStart, endLine),
    ...(backlogRemaining > 0 ? { backlog_remaining: backlogRemaining } : {}),
  }
}

export function finalizeCursor(
  state: ReflectionTranscriptState,
  entries: readonly TranscriptEntry[],
  snapshot: ReflectionSnapshot,
  success: boolean,
  succeededAt: string,
): ReflectionTranscriptState {
  if (!success) return deriveState(state, entries)

  const snapshotEntries = entries.slice(0, Math.max(0, snapshot.end_snapshot_line))
  return deriveState(
    {
      ...state,
      reflected_through_message_id: snapshot.end_message_id,
      reflected_through_byte_offset: reflectedThroughByteOffset(entries, snapshot.end_message_id),
      reflected_completed_steps: countCompletedSteps(snapshotEntries),
      last_reflection_succeeded_at: succeededAt,
    },
    entries,
  )
}

export function reflectedThroughByteOffset(entries: readonly TranscriptEntry[], messageId: string): number {
  let offset = 0
  let reflectedOffset = 0
  for (const entry of entries) {
    offset += Buffer.byteLength(`${JSON.stringify(entry)}\n`, "utf8")
    if (entry.source_message_id === messageId) reflectedOffset = offset
  }
  return reflectedOffset
}

export function initialReflectionState(): ReflectionTranscriptState {
  return {
    schema_version: REFLECTION_STATE_SCHEMA_VERSION,
    total_completed_steps: 0,
    reflected_completed_steps: 0,
    steps_since_last_successful_reflection: 0,
  }
}

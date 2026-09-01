import { Buffer } from "node:buffer"
import type { TranscriptEntry } from "./entries"

export const REFLECTION_STATE_SCHEMA_VERSION = "v3_assistant_steps" as const

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
}

export type ReflectionSnapshot = {
  readonly start_message_id: string
  readonly end_message_id: string
  readonly start_line: number
  readonly end_snapshot_line: number
  readonly entries: readonly TranscriptEntry[]
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
  return {
    ...state,
    schema_version: REFLECTION_STATE_SCHEMA_VERSION,
    total_completed_steps: totalCompletedSteps,
    reflected_completed_steps: reflectedCompletedSteps,
    steps_since_last_successful_reflection: Math.max(
      0,
      totalCompletedSteps - reflectedCompletedSteps,
    ),
  }
}

export function captureCursorSnapshot(
  entries: readonly TranscriptEntry[],
  state: ReflectionTranscriptState,
): ReflectionSnapshot | null {
  const anchorIndex = state.reflected_through_message_id
    ? entries.findIndex(
        (entry) =>
          isCanonicalEntry(entry) &&
          entry.source_message_id === state.reflected_through_message_id,
      )
    : -1
  const startIndex = entries.findIndex(
    (entry, index) => index > anchorIndex && isCanonicalEntry(entry),
  )
  if (startIndex < 0) return null

  let endIndex = -1
  for (let index = entries.length - 1; index >= startIndex; index -= 1) {
    const entry = entries[index]
    if (entry && isCanonicalEntry(entry)) {
      endIndex = index
      break
    }
  }
  const start = entries[startIndex]
  const end = entries[endIndex]
  if (!start || !end || !isCanonicalEntry(start) || !isCanonicalEntry(end)) return null

  return {
    start_message_id: start.source_message_id,
    end_message_id: end.source_message_id,
    start_line: anchorIndex + 1,
    end_snapshot_line: entries.length,
    entries: entries.slice(anchorIndex + 1),
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

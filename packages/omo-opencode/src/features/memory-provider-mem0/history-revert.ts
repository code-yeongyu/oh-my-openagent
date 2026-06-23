import type { Mem0HistoryEntry, Mem0HistoryRawEntry } from "./types"

export interface RevertUpdatePayload {
  text: string
  metadata?: Record<string, unknown>
}

export class HistoryRevertError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "HistoryRevertError"
  }
}

export function parseHistory(
  memory_id: string,
  rawEntries: Mem0HistoryRawEntry[],
): Mem0HistoryEntry[] {
  return rawEntries
    .filter((entry) => entry.new_value !== undefined && entry.event !== undefined)
    .map((entry) => ({
      memory_id,
      previous_value: entry.previous_value,
      new_value: entry.new_value as string,
      action: entry.event as "ADD" | "UPDATE" | "DELETE",
      created_at: entry.created_at ?? new Date(0).toISOString(),
    }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

export function findEntryAt(
  entries: Mem0HistoryEntry[],
  timestamp: string,
): Mem0HistoryEntry | undefined {
  const ordered = [...entries].sort((a, b) => a.created_at.localeCompare(b.created_at))
  let candidate: Mem0HistoryEntry | undefined
  for (const entry of ordered) {
    if (entry.created_at <= timestamp) {
      candidate = entry
    } else {
      break
    }
  }
  return candidate
}

export function buildRevertUpdate(
  entry: Mem0HistoryEntry,
  metadata?: Record<string, unknown>,
): RevertUpdatePayload {
  if (entry.action === "DELETE") {
    throw new HistoryRevertError(
      `Cannot revert to a DELETE entry for memory ${entry.memory_id}`,
    )
  }
  const text = entry.previous_value ?? entry.new_value
  if (!text) {
    throw new HistoryRevertError(
      `History entry for memory ${entry.memory_id} has no restorable value`,
    )
  }
  return metadata ? { text, metadata } : { text }
}

export function diffHistory(
  entries: Mem0HistoryEntry[],
): Array<{ from?: string; to: string; action: string; at: string }> {
  return entries.map((entry) => ({
    from: entry.previous_value,
    to: entry.new_value,
    action: entry.action,
    at: entry.created_at,
  }))
}

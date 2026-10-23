import type { TranscriptEntry } from "../journal"

// The entry right before a queue delta, reasoning skipped: the assistant proposal the delta's first user message answered,
// or the image-only user message / tool step that broke that adjacency (#10488 consent binding).
export function leadOf(entries: readonly TranscriptEntry[], startIndex: number): { readonly lead?: TranscriptEntry } {
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry === undefined) return {}
    if (entry.kind !== "reasoning") return { lead: entry }
  }
  return {}
}

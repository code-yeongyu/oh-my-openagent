// Byte-capped LOSSLESS batch selection for the facts payload.
//
// THE MEASUREMENT IS THE WRITER: `serializeFactsPayload` is the single serializer used both to
// write `facts-payload.json` (worker/spawn-payload.ts) and to measure a candidate batch here. A
// second serializer would let the two drift and re-admit oversized payloads - the disk incident
// this cap exists to prevent - so the writer imports this function rather than re-stringifying.
//
// LOSSLESS: nothing here truncates an entry, drops one silently, or advances a watermark. An
// entry that does not fit stays in the queue, byte-identical, for the next launch.

import type { FactsPayload } from "./extraction"
import type { FactsQueueEntry } from "./schema"

/** Hard ceiling for one launched payload, measured on the exact bytes written to disk. */
export const MAX_FACTS_PAYLOAD_BYTES = 131_072

/** An entry waiting at least this long outranks newer entries, so a backlog cannot starve it. */
export const FACTS_STARVATION_MS = 24 * 60 * 60_000

/** The payload without its entries: version/identity/today plus the people fields. */
export type FactsPayloadEnvelope = Omit<FactsPayload, "entries">

export interface CappedFactsBatchInput {
  readonly entries: readonly FactsQueueEntry[]
  readonly envelope: FactsPayloadEnvelope
  readonly now: Date
  readonly maxBytes?: number
  readonly starvationMs?: number
}

export interface CappedFactsBatch {
  /** Ascending by `end_snapshot_line` within each conversation - `markConsumed` relies on it. */
  readonly selected: readonly FactsQueueEntry[]
  /** Entries whose own single-entry payload exceeds the cap; never truncated, never consumed. */
  readonly oversized: readonly FactsQueueEntry[]
  /** True when the entry-free envelope alone exceeds the cap, so nothing can ever ship. */
  readonly envelopeOversized: boolean
}

/** THE serializer. Both the payload writer and the cap measurement call exactly this. */
export function serializeFactsPayload(payload: FactsPayload): string {
  return `${JSON.stringify(payload, null, 2)}\n`
}

/** Bytes the payload occupies on disk, measured on the serializer's own output. */
export function measureFactsPayloadBytes(payload: FactsPayload): number {
  return Buffer.byteLength(serializeFactsPayload(payload), "utf8")
}

function ascending(left: FactsQueueEntry, right: FactsQueueEntry): number {
  return left.range.end_snapshot_line - right.range.end_snapshot_line
}

function groupByConversation(
  entries: readonly FactsQueueEntry[],
): Map<string, FactsQueueEntry[]> {
  const groups = new Map<string, FactsQueueEntry[]>()
  for (const entry of entries) {
    const bucket = groups.get(entry.conversationId)
    if (bucket === undefined) groups.set(entry.conversationId, [entry])
    else bucket.push(entry)
  }
  for (const bucket of groups.values()) bucket.sort(ascending)
  return groups
}

function waitedMs(entry: FactsQueueEntry, now: Date): number {
  const enqueuedAt = Date.parse(entry.enqueuedAt)
  return Number.isNaN(enqueuedAt) ? 0 : now.getTime() - enqueuedAt
}

/**
 * Candidate order: starved conversations (their OLDEST entry has waited past the threshold)
 * first, oldest-first among themselves, then everything else newest-first so a fresh
 * conversation still gets extracted promptly while the backlog drains.
 */
function orderConversations(
  groups: Map<string, FactsQueueEntry[]>,
  now: Date,
  starvationMs: number,
): FactsQueueEntry[][] {
  const buckets = [...groups.values()]
  return buckets.sort((left, right) => {
    const leftWait = waitedMs(left[0] as FactsQueueEntry, now)
    const rightWait = waitedMs(right[0] as FactsQueueEntry, now)
    const leftStarved = leftWait >= starvationMs
    const rightStarved = rightWait >= starvationMs
    if (leftStarved !== rightStarved) return leftStarved ? -1 : 1
    // Starved batches drain oldest-first; the rest are taken newest-first.
    return leftStarved ? rightWait - leftWait : leftWait - rightWait
  })
}

/**
 * PREFIX CLOSURE: within a conversation an entry ships only with every older unconsumed entry
 * of the same conversation. Shipping a newer endpoint alone would advance the consumed
 * watermark past the older one, which `markConsumed` can never walk back - silent data loss.
 * So each conversation is grown one entry at a time and stops at the first entry that does not
 * fit; later entries of that conversation are held back even when they individually would.
 */
export function selectCappedFactsBatch(input: CappedFactsBatchInput): CappedFactsBatch {
  const maxBytes = input.maxBytes ?? MAX_FACTS_PAYLOAD_BYTES
  const starvationMs = input.starvationMs ?? FACTS_STARVATION_MS
  const envelopeBytes = measureFactsPayloadBytes({ ...input.envelope, entries: [] })
  if (envelopeBytes > maxBytes) return { selected: [], oversized: [], envelopeOversized: true }

  const groups = groupByConversation(input.entries)
  const oversized: FactsQueueEntry[] = []
  const selected: FactsQueueEntry[] = []
  for (const bucket of orderConversations(groups, input.now, starvationMs)) {
    for (const candidate of bucket) {
      if (measureFactsPayloadBytes({ ...input.envelope, entries: [candidate] }) > maxBytes) {
        oversized.push(candidate)
        break
      }
      const next = [...selected, candidate]
      if (measureFactsPayloadBytes({ ...input.envelope, entries: next }) > maxBytes) break
      selected.push(candidate)
    }
  }
  // Group the shipped entries back together so each conversation's endpoints stay ascending.
  const ordered = [...groupByConversation(selected).values()].flat()
  return { selected: ordered, oversized, envelopeOversized: false }
}

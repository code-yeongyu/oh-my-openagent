// Pure launch gating over the failure ledger. No IO and no clock of its own: the caller reads
// `failures.json` once per launch attempt and injects `now`, so every eligibility boundary is
// testable to the millisecond.
//
// KEY CONTRACT: records are matched on the PAIR (conversationId, end_message_id), never on the
// full triple. A ledger written before `end_snapshot_line` existed anchors its endpoints at 0,
// so a triple match would make those records invisible and silently relaunch a parked batch -
// the exact incident shape the failure ledger exists to prevent.

import type { FactsFailureRecord, FactsFailuresFile } from "./failures-schema"
import type { FactsQueueEntry } from "./schema"

/** Why an entry was not selected. Stable strings: `/facts` and the launch warning render them. */
export type FactsSkipReason = "parked" | "backoff" | "blocked-by-predecessor"

export interface FactsLaunchSelection {
  readonly selected: FactsQueueEntry[]
  readonly skipped: Readonly<Record<string, FactsSkipReason>>
}

/** The pair key, matching the queue's own dedup key and the failure ledger's record key. */
export function factsSelectionKey(conversationId: string, endMessageId: string): string {
  return `${conversationId}\u0000${endMessageId}`
}

function entryKey(entry: FactsQueueEntry): string {
  return factsSelectionKey(entry.conversationId, entry.range.end_message_id)
}

function recordKey(record: FactsFailureRecord): string {
  return factsSelectionKey(record.conversationId, record.end_message_id)
}

function dropReason(record: FactsFailureRecord | undefined, now: Date): FactsSkipReason | undefined {
  if (record === undefined) return undefined
  // Parking is terminal until a manual `/facts retry`; nothing here can unpark it.
  if (record.state === "parked") return "parked"
  if (record.nextEligibleAt === null) return "backoff"
  // Eligible AT the instant, not strictly after it.
  return now.getTime() < Date.parse(record.nextEligibleAt) ? "backoff" : undefined
}

/**
 * PREFIX GATING: a conversation's entries are ordered by their snapshot boundary, and the first
 * dropped entry blocks every later entry of that SAME conversation. Launching past a gap would
 * consume a newer endpoint and strand the older one behind an advanced watermark - data loss.
 * Other conversations are unaffected; each one gates independently.
 */
export function selectLaunchable(
  entries: readonly FactsQueueEntry[],
  failures: FactsFailuresFile | undefined,
  now: Date,
): FactsLaunchSelection {
  const records = new Map((failures?.entries ?? []).map((record) => [recordKey(record), record]))
  if (records.size === 0) return { selected: [...entries], skipped: {} }

  const byConversation = new Map<string, FactsQueueEntry[]>()
  for (const entry of entries) {
    const bucket = byConversation.get(entry.conversationId)
    if (bucket === undefined) byConversation.set(entry.conversationId, [entry])
    else bucket.push(entry)
  }

  const skipped: Record<string, FactsSkipReason> = {}
  for (const bucket of byConversation.values()) {
    const ordered = [...bucket].sort(
      (left, right) => left.range.end_snapshot_line - right.range.end_snapshot_line,
    )
    let blocked = false
    for (const entry of ordered) {
      const reason = blocked ? "blocked-by-predecessor" : dropReason(records.get(entryKey(entry)), now)
      if (reason === undefined) continue
      skipped[entryKey(entry)] = reason
      blocked = true
    }
  }
  return { selected: entries.filter((entry) => skipped[entryKey(entry)] === undefined), skipped }
}

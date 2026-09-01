// Oversize classification for the byte-capped facts payload.
//
// LOSSLESS: nothing here truncates an entry, splits inside one, or consumes anything. The two
// oversize shapes are recorded in the failure ledger ONLY; queue files, cursors and
// `consumed.json` are never touched, so the data stays extractable after a cap increase or a
// people-payload fix.
//
// The two shapes get DIFFERENT verdicts on purpose:
//  - one entry bigger than the whole cap can never ship as-is, so it parks IMMEDIATELY
//    (`applyFailure` parks `payload_entry_oversize` at streak 1) and T6's prefix gating holds
//    back that conversation's later entries. Backing it off instead would relaunch a batch
//    that is provably impossible - the 1088-attempt incident shape.
//  - an envelope (identity/today + the people fields) that alone exceeds the cap is a GLOBAL
//    condition owned by no single entry, so its frontiers take the NORMAL streak progression
//    and recover on their own once the people payload shrinks.

import {
  MAX_FACTS_PAYLOAD_BYTES,
  measureFactsPayloadBytes,
  type FactsPayloadEnvelope,
  type FactsQueueEntry,
} from "@oh-my-opencode/memory-core"

import { preflightFailureId, queueEntryTargets } from "./facts-failure-recording"
import type { FactsTerminalWrites } from "./facts-terminal-writes"

export interface OversizeClassificationInput {
  readonly terminal: FactsTerminalWrites
  readonly envelope: FactsPayloadEnvelope
  /** Entries T10's selection reported as individually oversize; may be empty. */
  readonly oversized: readonly FactsQueueEntry[]
  /** Every launchable entry, used to pick the per-conversation frontiers on envelope oversize. */
  readonly pending: readonly FactsQueueEntry[]
  readonly envelopeOversized: boolean
  readonly createFailureId?: () => string
  readonly warn?: (message: string, fields: Readonly<Record<string, unknown>>) => void
  readonly maxBytes?: number
}

/** Newest endpoint per conversation: the frontier a global condition is charged against. */
export function conversationFrontiers(
  entries: readonly FactsQueueEntry[],
): readonly FactsQueueEntry[] {
  const frontiers = new Map<string, FactsQueueEntry>()
  for (const entry of entries) {
    const current = frontiers.get(entry.conversationId)
    if (current === undefined || entry.range.end_snapshot_line > current.range.end_snapshot_line) {
      frontiers.set(entry.conversationId, entry)
    }
  }
  return [...frontiers.values()]
}

/**
 * Records the ledger consequences of an oversize payload. Returns true when the ENVELOPE is the
 * oversize thing, i.e. the launch must be refused outright rather than shipping a smaller batch.
 */
export async function classifyOversizePayload(input: OversizeClassificationInput): Promise<boolean> {
  const maxBytes = input.maxBytes ?? MAX_FACTS_PAYLOAD_BYTES
  if (input.envelopeOversized) {
    const envelopeBytes = measureFactsPayloadBytes({ ...input.envelope, entries: [] })
    input.warn?.("facts payload envelope exceeds the byte cap; nothing can be launched", {
      envelopeBytes,
      maxBytes,
      conversations: new Set(input.pending.map((entry) => entry.conversationId)).size,
    })
    await input.terminal.preflightFail(
      queueEntryTargets(conversationFrontiers(input.pending)),
      preflightFailureId(input.createFailureId),
      "payload_envelope_oversize",
      `facts payload envelope is ${envelopeBytes} bytes, above the ${maxBytes}-byte cap`,
    )
    return true
  }

  for (const entry of input.oversized) {
    const entryBytes = measureFactsPayloadBytes({ ...input.envelope, entries: [entry] })
    input.warn?.("facts queue entry exceeds the payload byte cap; parking it", {
      conversationId: entry.conversationId,
      endMessageId: entry.range.end_message_id,
      entryBytes,
      maxBytes,
    })
    await input.terminal.preflightFail(
      queueEntryTargets([entry]),
      preflightFailureId(input.createFailureId),
      "payload_entry_oversize",
      `facts entry payload is ${entryBytes} bytes, above the ${maxBytes}-byte cap`,
    )
  }
  return false
}

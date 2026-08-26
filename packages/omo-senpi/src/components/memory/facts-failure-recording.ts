// Failure-ledger seam for the facts runner: the port the terminal writes talk to, and the
// mapping from the two batch shapes the runner has (live queue entries, ledger endpoints)
// onto the store's `FactsFailureTarget`. Kept free of IO so both shapes stay comparable.

import { randomUUID } from "node:crypto"

import type {
  FactsFailureTarget,
  FactsQueueEntry,
  RecordFailureRequest,
} from "@oh-my-opencode/memory-core"

/** The slice of `FactsFailureStore` the terminal writes need; a test double implements it too. */
export interface FactsFailurePort {
  recordFailure(request: RecordFailureRequest): Promise<unknown>
  clearOnSuccess(targets: readonly FactsFailureTarget[]): Promise<unknown>
}

/** Ledger `queued` shape: what a run durably knows about the batch it owns. */
export interface FactsQueuedKey {
  readonly conversationId: string
  readonly end_message_id: string
  readonly end_snapshot_line: number
}

export function queueEntryTargets(entries: readonly FactsQueueEntry[]): readonly FactsFailureTarget[] {
  return entries.map((entry) => ({
    conversationId: entry.conversationId,
    endMessageId: entry.range.end_message_id,
    endSnapshotLine: entry.range.end_snapshot_line,
  }))
}

/**
 * Ledger endpoints -> failure targets. A ledger written before this field existed carries no
 * snapshot boundary; those endpoints anchor at 0 rather than being dropped, because losing the
 * increment is the failure mode the terminal-write ordering exists to prevent.
 */
export function ledgerTargets(queued: readonly FactsQueuedKey[]): readonly FactsFailureTarget[] {
  return queued.map((key) => ({
    conversationId: key.conversationId,
    endMessageId: key.end_message_id,
    endSnapshotLine: typeof key.end_snapshot_line === "number" ? key.end_snapshot_line : 0,
  }))
}

/** Failures raised before a run dir exists have no runId to key idempotency on. */
export function preflightFailureId(createId: () => string = randomUUID): string {
  return `preflight-${createId()}`
}

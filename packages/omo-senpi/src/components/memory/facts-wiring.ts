// Facts queue wiring: publishes a durable queue entry on successful settle and
// re-lists leftover entries at session_start so a crashed extractor run is relaunchable.
// Journal wiring is NOT extended here: it keeps its existing AppendResult contract.

import { join } from "node:path"

import {
  FactsQueue,
  TranscriptJournal,
  type FactsEnqueueResult,
  type FactsQueueEntry,
  type MemoryIdentityPaths,
} from "@oh-my-opencode/memory-core"

import type { ComponentLogger } from "../../extension/types"

const DISABLED: FactsEnqueueResult = { enqueued: false, reason: "no-new-entries" }

export interface FactsExtractorPort {
  launchPending(signal?: AbortSignal): Promise<unknown>
  reconcilePending(signal?: AbortSignal): Promise<unknown>
}

export interface MemoryFactsWiringOptions {
  readonly identity: string
  readonly identityPaths: MemoryIdentityPaths
  /** `memory.facts.enabled` kill switch, read per call so a config reload is honored. */
  readonly factsEnabled: () => boolean
  readonly debounceSettles?: () => number
  readonly extractor?: FactsExtractorPort
  readonly createJournal?: (journalDir: string) => TranscriptJournal
  readonly now?: () => Date
  readonly logger?: ComponentLogger
}

export interface MemoryFactsWiring {
  /** Enqueue the un-enqueued delta for a settled conversation. Never throws. */
  enqueueSettled(conversationId: string, signal?: AbortSignal): Promise<FactsEnqueueResult>
  /** Enqueue, count the settle gate, and fire one all-pending launch at the threshold. */
  onSettled(conversationId: string): Promise<FactsEnqueueResult>
  /** Leftover queue entries a crashed run left behind, ready for relaunch. */
  reconcilePending(): Promise<FactsQueueEntry[]>
  /** Fire facts-run reconciliation without blocking session_start on the child. */
  reconcileExtractor(): void
  /** Shutdown drain step (c): launch pending work only when the settle threshold is already met. */
  launchIfThresholdMet(signal?: AbortSignal): Promise<boolean>
  /** Terminal SUCCESS only: drops the batch and advances the consumed watermark. */
  markConsumed(entries: readonly FactsQueueEntry[]): Promise<void>
}

export function createMemoryFactsWiring(options: MemoryFactsWiringOptions): MemoryFactsWiring {
  const createJournal =
    options.createJournal ?? ((journalDir: string) => new TranscriptJournal({ journalDir }))
  const queue = new FactsQueue({
    identityPaths: options.identityPaths,
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  let settles = 0

  const fire = (operation: "launch" | "reconcile", signal?: AbortSignal): void => {
    if (signal?.aborted === true) return
    const promise = operation === "launch"
      ? options.extractor?.launchPending(signal)
      : options.extractor?.reconcilePending(signal)
    void promise?.catch((error) => {
      options.logger?.warn(`facts extractor ${operation} failed`, { error: String(error) })
    })
  }

  const wiring: MemoryFactsWiring = {
    async enqueueSettled(conversationId: string, signal?: AbortSignal): Promise<FactsEnqueueResult> {
      if (isAborted(signal) || !options.factsEnabled()) return DISABLED
      try {
        const journal = createJournal(join(options.identityPaths.transcripts, conversationId))
        const entries = await journal.readEntries()
        if (isAborted(signal) || entries.length === 0) return DISABLED
        return await queue.enqueue({
          identity: options.identity,
          sessionId: conversationId,
          conversationId,
          entries,
          signal,
        })
      } catch (error) {
        options.logger?.warn("facts queue enqueue failed", { conversationId, error: String(error) })
        return DISABLED
      }
    },

    async onSettled(conversationId: string): Promise<FactsEnqueueResult> {
      const result = await wiring.enqueueSettled(conversationId)
      if (!options.factsEnabled()) return result
      settles += 1
      if (settles >= Math.max(1, options.debounceSettles?.() ?? 4)) {
        settles = 0
        fire("launch")
      }
      return result
    },

    async reconcilePending(): Promise<FactsQueueEntry[]> {
      if (!options.factsEnabled()) return []
      try {
        return await queue.listPending()
      } catch (error) {
        options.logger?.warn("facts queue reconcile failed", { error: String(error) })
        return []
      }
    },

    reconcileExtractor(): void {
      if (options.factsEnabled()) fire("reconcile")
    },

    async launchIfThresholdMet(signal?: AbortSignal): Promise<boolean> {
      if (isAborted(signal) || !options.factsEnabled()) return false
      if (settles < Math.max(1, options.debounceSettles?.() ?? 4)) return false
      if (isAborted(signal) || options.extractor === undefined) return false
      settles = 0
      try {
        if (isAborted(signal)) return false
        await options.extractor.launchPending(signal)
      } catch (error) {
        options.logger?.warn("facts extractor launch failed", { error: String(error) })
      }
      return true
    },

    async markConsumed(entries: readonly FactsQueueEntry[]): Promise<void> {
      try {
        await queue.markConsumed(entries)
      } catch (error) {
        options.logger?.warn("facts queue consume failed", { error: String(error) })
      }
    },
  }
  return wiring
}

/** AbortSignal state is mutable across awaits and callback probes, so every boundary reads it live. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

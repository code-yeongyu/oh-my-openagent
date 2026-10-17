// Facts queue wiring: publishes a durable queue entry on successful settle and
// reconciles old artifacts at session_start without launching leftover work.
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
import type { FactsModelSelection } from "./facts-runner-types"

const DISABLED: FactsEnqueueResult = { enqueued: false, reason: "no-new-entries" }

export interface FactsExtractorPort {
  launchPending(signal?: AbortSignal, selection?: FactsModelSelection): Promise<unknown>
  reconcilePending(signal?: AbortSignal): Promise<unknown>
  cancelActive?(): Promise<void>
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
  /** Enqueue the settled conversation delta. */
  onSettled(conversationId: string, selection?: FactsModelSelection): Promise<FactsEnqueueResult>
  /** Leftover queue entries a crashed run left behind, ready for relaunch. */
  reconcilePending(): Promise<FactsQueueEntry[]>
  /** Recover old artifacts and reset first-turn admission for a bound session, without a child. */
  reconcileExtractor(conversationId?: string): void
  /** Explicit user action (unpark) launches pending work immediately. */
  launchExtractor(): void
  cancelActive(): Promise<void>
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
  const settledSessions = new Set<string>()

  const fire = (operation: "launch" | "reconcile", signal?: AbortSignal, selection?: FactsModelSelection): void => {
    if (signal?.aborted === true) return
    const promise = operation === "launch"
      ? options.extractor?.launchPending(signal, selection)
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

    async onSettled(conversationId: string, selection?: FactsModelSelection): Promise<FactsEnqueueResult> {
      const pending = settledSessions.has(conversationId) ? [] : await wiring.reconcilePending()
      const result = await wiring.enqueueSettled(conversationId)
      if (!options.factsEnabled()) return result
      settledSessions.add(conversationId)
      settles += 1
      if (pending.length > 0 || settles >= Math.max(1, options.debounceSettles?.() ?? 4)) {
        settles = 0
        fire("launch", undefined, selection)
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

    reconcileExtractor(conversationId?: string): void {
      if (conversationId !== undefined) settledSessions.delete(conversationId)
      if (options.factsEnabled()) fire("reconcile")
    },

    launchExtractor(): void {
      if (options.factsEnabled()) fire("launch")
    },

    async cancelActive(): Promise<void> {
      await options.extractor?.cancelActive?.()
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

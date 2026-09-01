// Durable facts queue (IC-6). Publication is `.tmp` + rename under the identity-scoped
// `facts-queue` lock; the enqueue watermark is MONOTONIC so a late-finishing older batch
// can never republish a range overlapping a retained newer entry.

import { mkdir, readFile, readdir, rename, rm, writeFile } from "../fs/resilient"
import { join } from "node:path"

import type { MemoryIdentityPaths } from "../identity"
import { isCanonicalEntry, type TranscriptEntry } from "../journal"
import { createLockRecord, factsQueueLockPath, withLock } from "../locks"
import {
  FACTS_QUEUE_VERSION,
  canonicalPosition,
  factsQueuePaths,
  initialCursor,
  parseConsumed,
  parseCursor,
  parseQueueEntry,
  type FactsConsumedRecord,
  type FactsConsumedWatermark,
  type FactsCursor,
  type FactsQueueEntry,
  type FactsQueueLayout,
  type FactsQueueRange,
} from "./schema"

const LOCK_WAIT_MS = 2000

export interface FactsEnqueueRequest {
  readonly identity: string
  readonly sessionId: string
  readonly conversationId: string
  readonly entries: readonly TranscriptEntry[]
  readonly signal?: AbortSignal
}

export type FactsEnqueueResult =
  | { readonly enqueued: true; readonly entry: FactsQueueEntry }
  | { readonly enqueued: false; readonly reason: "no-new-entries" }

export interface FactsQueueOptions {
  readonly identityPaths: MemoryIdentityPaths
  readonly now?: () => Date
}

export class FactsQueue {
  private readonly layout: FactsQueueLayout
  private readonly lockPath: string
  private readonly now: () => Date

  constructor(options: FactsQueueOptions) {
    this.layout = factsQueuePaths(options.identityPaths)
    this.lockPath = factsQueueLockPath(options.identityPaths.locks)
    this.now = options.now ?? (() => new Date())
  }

  /**
   * Publishes the delta strictly after the EFFECTIVE enqueue anchor: the greatest
   * canonical position among the persisted enqueue watermark, the consumed watermark,
   * and every RETAINED queue file for this conversation. Reading retained files closes
   * the crash window where a queue file landed but its cursor write did not.
   */
  async enqueue(request: FactsEnqueueRequest): Promise<FactsEnqueueResult> {
    const abortedNow = (): boolean => request.signal?.aborted === true
    if (abortedNow()) return { enqueued: false, reason: "no-new-entries" }
    return this.locked(async () => {
      const anchor = await this.effectiveAnchor(request.conversationId, request.entries)
      const startIndex = request.entries.findIndex(
        (entry, index) => index > anchor && isCanonicalEntry(entry),
      )
      if (startIndex < 0) return { enqueued: false, reason: "no-new-entries" }

      let endIndex = -1
      for (let index = request.entries.length - 1; index >= startIndex; index -= 1) {
        const entry = request.entries[index]
        if (entry && isCanonicalEntry(entry)) {
          endIndex = index
          break
        }
      }
      const start = request.entries[startIndex]
      const end = endIndex < 0 ? undefined : request.entries[endIndex]
      if (start === undefined || end === undefined) return { enqueued: false, reason: "no-new-entries" }

      const at = this.now()
      const entry: FactsQueueEntry = {
        version: FACTS_QUEUE_VERSION,
        identity: request.identity,
        sessionId: request.sessionId,
        conversationId: request.conversationId,
        range: {
          start_message_id: start.source_message_id,
          end_message_id: end.source_message_id,
          start_line: startIndex,
          end_snapshot_line: request.entries.length,
        },
        enqueuedAt: at.toISOString(),
        entries: request.entries.slice(startIndex),
      }

      if (abortedNow()) return { enqueued: false, reason: "no-new-entries" }
      await this.publish(entry, at, request.signal)
      if (abortedNow()) return { enqueued: true, entry }
      await this.advanceEnqueued(request.conversationId, entry.range, request.signal)
      return { enqueued: true, entry }
    })
  }

  /** Every retained queue file, oldest first: crash recovery relaunches exactly these. */
  async listPending(): Promise<FactsQueueEntry[]> {
    return this.locked(() => this.listPendingUnlocked())
  }

  /**
   * Terminal SUCCESS only: deletes the batch's files and advances the consumed
   * watermark. The enqueue watermark is NEVER touched here, so an older batch
   * finishing late cannot roll it backward.
   */
  async markConsumed(entries: readonly FactsQueueEntry[]): Promise<void> {
    if (entries.length === 0) return
    await this.locked(async () => {
      const pending = await this.listPendingUnlocked()
      const consumedKeys = new Set(
        entries.map((entry) => `${entry.conversationId}\u0000${entry.range.end_message_id}`),
      )
      for (const candidate of pending) {
        const key = `${candidate.conversationId}\u0000${candidate.range.end_message_id}`
        if (consumedKeys.has(key)) await rm(candidate.filePath, { force: true })
      }
      await this.advanceConsumed(entries)
    })
  }

  async readCursor(conversationId: string): Promise<FactsCursor> {
    return this.locked(() => this.readCursorUnlocked(conversationId))
  }

  private async locked<T>(task: () => Promise<T>): Promise<T> {
    await mkdir(this.layout.queueDir, { recursive: true })
    await mkdir(join(this.lockPath, ".."), { recursive: true })
    const record = await createLockRecord("facts-queue")
    return withLock(this.lockPath, record, task, { waitTimeoutMs: LOCK_WAIT_MS })
  }

  private async effectiveAnchor(
    conversationId: string,
    entries: readonly TranscriptEntry[],
  ): Promise<number> {
    const cursor = await this.readCursorUnlocked(conversationId)
    const consumed = await this.readConsumedUnlocked()
    const candidates: (string | null)[] = [
      cursor.enqueued_through_message_id,
      cursor.consumed_through_message_id,
      consumed.consumed[conversationId]?.end_message_id ?? null,
    ]
    for (const pending of await this.listPendingUnlocked()) {
      if (pending.conversationId !== conversationId) continue
      candidates.push(pending.range.end_message_id)
    }

    let anchor = -1
    for (const candidate of candidates) {
      const position = canonicalPosition(entries, candidate)
      // A retained endpoint must lie STRICTLY BEFORE the snapshot boundary: non-canonical
      // entries may trail the last message, so position and boundary are not equal.
      if (position >= entries.length) continue
      if (position > anchor) anchor = position
    }
    return anchor
  }

  private async publish(entry: FactsQueueEntry, at: Date, signal?: AbortSignal): Promise<void> {
    const target = this.layout.entryPath(entry.conversationId, entry.range.end_message_id, at)
    const temporary = `${target}.tmp`
    await writeFile(temporary, `${JSON.stringify(entry, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    if (signal?.aborted === true) return rm(temporary, { force: true })
    await rename(temporary, target)
  }

  private async listPendingUnlocked(): Promise<(FactsQueueEntry & { readonly filePath: string })[]> {
    let names: string[]
    try {
      names = await readdir(this.layout.queueDir)
    } catch {
      return []
    }
    const entries: (FactsQueueEntry & { readonly filePath: string })[] = []
    for (const name of names.sort()) {
      if (!name.endsWith(".json") || name === "consumed.json" || name === "failures.json") continue
      const filePath = join(this.layout.queueDir, name)
      const raw = await readFile(filePath, "utf8").catch(() => undefined)
      if (raw === undefined) continue
      const parsed = parseQueueEntry(raw)
      if (parsed === undefined) continue
      entries.push({ ...parsed, filePath })
    }
    return entries
  }

  private async readCursorUnlocked(conversationId: string): Promise<FactsCursor> {
    const raw = await readFile(this.layout.cursorPath(conversationId), "utf8").catch(() => undefined)
    return raw === undefined ? initialCursor() : parseCursor(raw)
  }

  private async readConsumedUnlocked(): Promise<FactsConsumedWatermark> {
    const raw = await readFile(this.layout.consumedPath, "utf8").catch(() => undefined)
    return raw === undefined ? { version: FACTS_QUEUE_VERSION, consumed: {} } : parseConsumed(raw)
  }

  /** MONOTONIC: only a strictly later snapshot boundary may move the enqueue watermark. */
  private async advanceEnqueued(conversationId: string, range: FactsQueueRange, signal?: AbortSignal): Promise<void> {
    const cursor = await this.readCursorUnlocked(conversationId)
    if (range.end_snapshot_line <= cursor.enqueued_through_snapshot_line) return
    if (signal?.aborted === true) return
    await this.writeCursor(conversationId, {
      ...cursor,
      enqueued_through_message_id: range.end_message_id,
      enqueued_through_snapshot_line: range.end_snapshot_line,
    })
  }

  private async advanceConsumed(entries: readonly FactsQueueEntry[]): Promise<void> {
    const consumed = await this.readConsumedUnlocked()
    const next: Record<string, FactsConsumedRecord> = { ...consumed.consumed }
    const consumedAt = this.now().toISOString()

    for (const entry of entries) {
      const cursor = await this.readCursorUnlocked(entry.conversationId)
      // A late older batch carries a SMALLER snapshot boundary than the newer batch that
      // already advanced this watermark, so it is rejected here instead of regressing it.
      if (entry.range.end_snapshot_line <= cursor.consumed_through_snapshot_line) continue
      await this.writeCursor(entry.conversationId, {
        ...cursor,
        consumed_through_message_id: entry.range.end_message_id,
        consumed_through_snapshot_line: entry.range.end_snapshot_line,
      })
      next[entry.conversationId] = {
        end_message_id: entry.range.end_message_id,
        end_snapshot_line: entry.range.end_snapshot_line,
        consumedAt,
      }
    }

    const payload: FactsConsumedWatermark = { version: FACTS_QUEUE_VERSION, consumed: next }
    const temporary = `${this.layout.consumedPath}.tmp`
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    await rename(temporary, this.layout.consumedPath)
  }

  private async writeCursor(conversationId: string, cursor: FactsCursor): Promise<void> {
    await mkdir(this.layout.cursorDir, { recursive: true })
    const target = this.layout.cursorPath(conversationId)
    const temporary = `${target}.tmp`
    await writeFile(temporary, `${JSON.stringify(cursor, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    await rename(temporary, target)
  }
}

export {
  FACTS_QUEUE_VERSION,
  factsQueuePaths,
  type FactsConsumedRecord,
  type FactsConsumedWatermark,
  type FactsCursor,
  type FactsQueueEntry,
  type FactsQueueRange,
} from "./schema"

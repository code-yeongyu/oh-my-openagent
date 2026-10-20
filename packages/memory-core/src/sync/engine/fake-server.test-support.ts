// A deterministic in-memory sync server with the contract's ordering rules: one sequence per
// account, `base_seq == head` appends, a repost of a batch id answers its original seq, digests
// bound at reservation, and retention that leaves a snapshot behind compacted history.

import { createHash } from "node:crypto"

import type { AppendResult, PullPage, PulledEntry, SnapshotRef, StreamHandlers, Transport } from "./ports"

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

interface Upload {
  readonly size: number
  readonly digest: string
  bytes: Uint8Array | null
}

export class FakeSyncServer {
  readonly entries: PulledEntry[] = []
  readonly objects = new Map<string, Uint8Array>()
  private readonly uploads = new Map<string, Upload>()
  private readonly byBatch = new Map<string, number>()
  private readonly listeners = new Set<StreamHandlers>()
  private ids = 0
  snapshot: SnapshotRef | null = null
  /** Entries at or below this seq were compacted away (only the snapshot covers them). */
  trimmedThrough = 0
  /** Every append request served, in order (stale ones included). */
  readonly appends: { readonly batchId: string; readonly baseSeq: number; readonly ok: boolean }[] = []
  /** When set, the next page repeats its first entry (a replayed delivery). */
  duplicateNextPage = false
  private readonly replays: PulledEntry[] = []
  /** Runs once, just before the next append is served: another device's push racing this one. */
  beforeNextAppend: (() => Promise<void>) | null = null

  get head(): number {
    return this.entries.at(-1)?.seq ?? this.trimmedThrough
  }

  transport(author: string): Transport {
    return {
      pull: async (after, limit) => this.pull(after, limit),
      download: async (objectId) => {
        const bytes = this.objects.get(objectId)
        if (bytes === undefined) throw new Error(`no object ${objectId}`)
        return bytes
      },
      reserve: async (size, digest) => {
        const id = `up${++this.ids}`
        this.uploads.set(id, { size, digest, bytes: null })
        return id
      },
      upload: async (uploadId, bytes) => {
        const upload = this.uploads.get(uploadId)
        if (upload === undefined) throw new Error(`no upload ${uploadId}`)
        if (bytes.length !== upload.size || sha256Hex(bytes) !== upload.digest) throw new Error("bytes differ from the reservation")
        upload.bytes = bytes
      },
      append: async (request) => {
        const race = this.beforeNextAppend
        this.beforeNextAppend = null
        if (race !== null) await race()
        return this.append(request, author)
      },
      subscribe: (handlers) => {
        this.listeners.add(handlers)
        handlers.onConnected(true)
        return () => this.listeners.delete(handlers)
      },
    }
  }

  /** Drops the stream for every subscriber (they fall back to polling). */
  disconnect(): void {
    for (const l of this.listeners) l.onConnected(false)
    this.listeners.clear()
  }

  /** Swaps the stored bytes of `seq`'s object, keeping the entry (a storage-side tamper). */
  tamperObject(seq: number, bytes: Uint8Array): void {
    const entry = this.entries.find((e) => e.seq === seq)
    if (entry === undefined) throw new Error(`no entry ${seq}`)
    this.objects.set(entry.objectId, bytes)
  }

  /** Replaces an entry with different bytes under the same (seq, batch id) and a matching digest. */
  rewriteEntry(seq: number, bytes: Uint8Array): void {
    const at = this.entries.findIndex((e) => e.seq === seq)
    const entry = this.entries[at]
    if (entry === undefined) throw new Error(`no entry ${seq}`)
    const objectId = `obj${++this.ids}`
    this.objects.set(objectId, bytes)
    this.entries[at] = { ...entry, objectId, digest: sha256Hex(bytes) }
  }

  /**
   * Re-delivers `seq` in the next page with other bytes under the same (seq, batch id) - an
   * already-applied entry replayed with new content - leaving stored history unchanged.
   */
  replayWithBytes(seq: number, bytes: Uint8Array): void {
    const entry = this.entries.find((e) => e.seq === seq)
    if (entry === undefined) throw new Error(`no entry ${seq}`)
    const objectId = `obj${++this.ids}`
    this.objects.set(objectId, bytes)
    this.replays.push({ ...entry, objectId, digest: sha256Hex(bytes) })
  }

  /** Compacts history through `coversSeq` into a snapshot object built by a device. */
  compact(coversSeq: number, snapshotBytes: Uint8Array): void {
    const objectId = `snap${++this.ids}`
    this.objects.set(objectId, snapshotBytes)
    this.snapshot = { coversSeq, objectIds: [objectId], digest: sha256Hex(snapshotBytes) }
    this.trimmedThrough = coversSeq
    this.entries.splice(0, this.entries.findIndex((e) => e.seq > coversSeq))
  }

  private pull(after: number, limit: number): PullPage {
    const snapshot = this.snapshot !== null && after < this.trimmedThrough ? this.snapshot : null
    const from = snapshot === null ? after : snapshot.coversSeq
    const later = this.entries.filter((e) => e.seq > from)
    const page = later.slice(0, limit)
    const first = page[0]
    const repeated = this.duplicateNextPage && first !== undefined ? [first, ...page] : page
    const entries = [...this.replays.splice(0), ...repeated]
    this.duplicateNextPage = false
    return { snapshot, entries, head: this.head, more: later.length > limit }
  }

  private append(request: Parameters<Transport["append"]>[0], author: string): AppendResult {
    const known = this.byBatch.get(request.batchId)
    if (known !== undefined) return { ok: true, seq: known }
    const ok = request.baseSeq === this.head
    this.appends.push({ batchId: request.batchId, baseSeq: request.baseSeq, ok })
    if (!ok) return { ok: false, error: "stale_base", head: this.head }
    const upload = this.uploads.get(request.uploadId)
    if (upload?.bytes == null || upload.digest !== request.digest) throw new Error("append without a matching upload")
    const objectId = `obj${++this.ids}`
    this.objects.set(objectId, upload.bytes)
    const seq = this.head + 1
    this.entries.push({ seq, kind: "batch", batchId: request.batchId, digest: request.digest, objectId, author })
    this.byBatch.set(request.batchId, seq)
    for (const l of this.listeners) l.onAdvanced(seq)
    return { ok: true, seq }
  }
}

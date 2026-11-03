// The outgoing half of the journal (#12286). `pending.json` is an index: per captured item its key,
// a digest, its size and where its ops sit, plus the metadata of the batch being sent. A capture
// appends its items' ops to one segment file in `pending/` and makes it durable once (an fsync per
// item would double a large capture's time); a sealed batch's bytes are a file of their own. So a
// push reads and writes what one batch needs instead of the whole backlog. A file is durable before
// the index names it and removed only after the index stops naming it: a crash leaves at most an
// unnamed file, which `sweep` drops.

import { createHash, randomBytes } from "node:crypto"
import { join } from "node:path"

import { syncJournalDirectory } from "../../journal/fsync"
import { type FileHandle, mkdir, open, readdir, readFile, rm, writeHandleAll } from "../../fs/resilient"
import { readJson, writeAtomic, writeJson } from "./atomic"

/** One captured item waiting to be pushed. */
export interface PendingItem {
  readonly key: string
  /** sha256 of the key and the ops: the item's identity. */
  readonly digest: string
  /** Plaintext size of the ops, what the batch bound counts. */
  readonly bytes: number
  /** The segment file in `pending/` holding the ops, and their offset in it. */
  readonly segment: string
  readonly offset: number
}

export interface OutgoingBatch {
  readonly batchId: string
  readonly baseSeq: number
  /** sha256 of the sealed bytes, kept at `pending/batch-<batchId>.bin`. */
  readonly digest: string
  readonly uploadId: string | null
  readonly epoch: number
  readonly link: string
  readonly recordSig: string
  readonly stage: "sealed" | "reserved" | "uploaded"
  readonly items: readonly PendingItem[]
}

export interface PendingOps {
  readonly items: readonly PendingItem[]
  readonly outgoing: OutgoingBatch | null
}

/** Collects one capture's ops into a fresh segment; nothing in it counts until `finish` returns. */
export interface SegmentWriter {
  add(key: string, ops: Uint8Array): Promise<PendingItem>
  /** Makes every added item durable. */
  finish(): Promise<void>
  /** Releases the file without making it durable; the next sweep removes it. */
  discard(): Promise<void>
}

/** What builds before #12286 wrote: every item's base64 ops, and the sealed bytes, inline. */
interface InlineItem {
  readonly key: string
  readonly ops: string
}
type InlineOutgoing = Omit<OutgoingBatch, "items"> & { readonly bytes: string; readonly items: readonly InlineItem[] }
type StoredPending = { readonly items: readonly object[]; readonly outgoing: (object & { readonly items: readonly object[] }) | null }

const EMPTY: PendingOps = { items: [], outgoing: null }

const isInline = (item: object): item is InlineItem => "ops" in item && typeof item.ops === "string"

const itemDigest = (key: string, ops: Uint8Array): string => createHash("sha256").update(key).update("\u0000").update(ops).digest("hex")

export class Outbox {
  private readonly index: string
  private readonly dir: string

  constructor(syncDir: string) {
    this.index = join(syncDir, "pending.json")
    this.dir = join(syncDir, "pending")
  }

  async read(): Promise<PendingOps> {
    const stored = await readJson<StoredPending>(this.index, EMPTY)
    if (!stored.items.some(isInline) && (stored.outgoing === null || !("bytes" in stored.outgoing))) return stored as PendingOps
    return this.upgrade(stored as { readonly items: readonly InlineItem[]; readonly outgoing: InlineOutgoing | null })
  }

  write(pending: PendingOps): Promise<void> {
    return writeJson(this.index, pending)
  }

  segment(): SegmentWriter {
    const segment = `seg-${randomBytes(8).toString("hex")}.ops`
    let handle: FileHandle | null = null
    let offset = 0
    return {
      add: async (key, ops) => {
        if (handle === null) {
          await mkdir(this.dir, { recursive: true })
          handle = await open(join(this.dir, segment), "wx")
        }
        await writeHandleAll(handle, ops)
        const item: PendingItem = { key, digest: itemDigest(key, ops), bytes: ops.byteLength, segment, offset }
        offset += ops.byteLength
        return item
      },
      finish: async () => {
        if (handle === null) return
        const file = handle
        handle = null
        try {
          await file.sync()
        } finally {
          await file.close()
        }
        await syncJournalDirectory(this.dir)
      },
      discard: async () => {
        const file = handle
        handle = null
        await file?.close()
      },
    }
  }

  /** One item's ops, checked against its digest: a damaged journal fails here, never on the wire. */
  async readOps(item: PendingItem): Promise<Uint8Array> {
    const ops = new Uint8Array(item.bytes)
    const handle = await open(join(this.dir, item.segment), "r")
    try {
      for (let done = 0; done < item.bytes; ) {
        const { bytesRead } = await handle.read(ops, done, item.bytes - done, item.offset + done)
        if (bytesRead === 0) throw new Error(`the pending ops of ${item.key} end early in ${item.segment}`)
        done += bytesRead
      }
    } finally {
      await handle.close()
    }
    if (itemDigest(item.key, ops) !== item.digest) throw new Error(`the pending ops of ${item.key} in ${item.segment} do not match their digest`)
    return ops
  }

  putBatch(batchId: string, bytes: Uint8Array): Promise<void> {
    return writeAtomic(this.batchPath(batchId), bytes)
  }

  async readBatch(batchId: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.batchPath(batchId)))
  }

  /** Drops every file `pending` does not name: sent segments, finished batches, a crash's leftovers. */
  async sweep(pending: PendingOps): Promise<void> {
    const keep = new Set([...pending.items, ...(pending.outgoing?.items ?? [])].map((i) => i.segment))
    if (pending.outgoing !== null) keep.add(`batch-${pending.outgoing.batchId}.bin`)
    const names = await readdir(this.dir).catch(() => [] as string[])
    for (const name of names) if (!keep.has(name)) await rm(join(this.dir, name), { force: true })
  }

  private batchPath(batchId: string): string {
    return join(this.dir, `batch-${batchId}.bin`)
  }

  /** Moves an inline journal's ops and sealed bytes into files, then rewrites it as an index. */
  private async upgrade(stored: { readonly items: readonly InlineItem[]; readonly outgoing: InlineOutgoing | null }): Promise<PendingOps> {
    const writer = this.segment()
    const filed = new Map<string, PendingItem>()
    const file = async (items: readonly InlineItem[]): Promise<PendingItem[]> => {
      const out: PendingItem[] = []
      for (const item of items) {
        const id = `${item.key}\u0000${item.ops}`
        const known = filed.get(id) ?? (await writer.add(item.key, new Uint8Array(Buffer.from(item.ops, "base64"))))
        filed.set(id, known)
        out.push(known)
      }
      return out
    }
    let pending: PendingOps
    try {
      const items = await file(stored.items)
      let outgoing: OutgoingBatch | null = null
      if (stored.outgoing !== null) {
        const { bytes, items: carried, ...meta } = stored.outgoing
        outgoing = { ...meta, items: await file(carried) }
        await this.putBatch(meta.batchId, new Uint8Array(Buffer.from(bytes, "base64")))
      }
      pending = { items, outgoing }
      await writer.finish()
    } finally {
      await writer.discard()
    }
    await this.write(pending)
    return pending
  }
}

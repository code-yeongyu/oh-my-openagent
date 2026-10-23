import { compareBatchIds, deleteFile, dropFile, fileStat, listQuarantine, listSpool, QUARANTINE_DIR, type SpoolContext } from "./otlp-spool-dir"
import type { Signal } from "./otlp-spool-file"

/**
 * Sizes of sealed batch files keyed by `<signal>-<batchId>`. A sealed batch is never written again
 * (claims only rename it), so its size is stat'ed once per process instead of on every cap check.
 */
type SpoolSizeCache = Map<string, number>

const sizeKey = (signal: Signal, batchId: string): string => `${signal}-${batchId}`

/**
 * Quarantined files go first (their records were counted when they were quarantined, so they are not
 * counted again), then the oldest sealed batches; active files and in-flight claims are never
 * evicted. Returns the spool's total size, quarantine included, after eviction.
 */
export function enforceSpoolCap(ctx: SpoolContext, sizes: SpoolSizeCache = new Map()): number {
  const entries = listSpool(ctx.dir)
  let total = 0
  const sealed: { readonly name: string; readonly batchId: string; readonly size: number }[] = []
  const present = new Set<string>()
  const quarantined = listQuarantine(ctx)
  for (const file of quarantined) total += file.size
  for (const entry of entries) {
    if (entry.name === QUARANTINE_DIR) continue
    const key = entry.kind === "batch" || entry.kind === "sending" ? sizeKey(entry.signal, entry.batchId) : undefined
    let size = key === undefined ? undefined : sizes.get(key)
    if (size === undefined) {
      const stat = fileStat(ctx.dir, entry.name)
      if (stat === null) continue
      size = stat.size
      if (key !== undefined) sizes.set(key, size)
    }
    if (key !== undefined) present.add(key)
    total += size
    if (entry.kind === "batch") sealed.push({ name: entry.name, batchId: entry.batchId, size })
  }
  for (const key of sizes.keys()) if (!present.has(key)) sizes.delete(key)
  sealed.sort((a, b) => compareBatchIds(a.batchId, b.batchId))
  for (const file of quarantined) {
    if (total <= ctx.capBytes) break
    if (deleteFile(ctx.dir, file.path)) total -= file.size
  }
  for (const file of sealed) {
    if (total <= ctx.capBytes) break
    dropFile(ctx, file.name, "evicted")
    total -= file.size
  }
  return total
}

/**
 * Enforces the cap after each of this process's seals without listing the directory every time:
 * the last scan's total plus the bytes sealed since is an upper bound for everything this process
 * added (sends only shrink the spool), so the directory is scanned only once that bound passes the
 * cap. Other writers enforce the cap on their own seals.
 */
export class SpoolCap {
  readonly #ctx: SpoolContext
  readonly #sizes: SpoolSizeCache = new Map()
  #bound: number | null = null

  constructor(ctx: SpoolContext) {
    this.#ctx = ctx
  }

  sealed(signal: Signal, batchId: string, bytes: number): void {
    this.#sizes.set(sizeKey(signal, batchId), bytes)
    if (this.#bound !== null && this.#bound + bytes <= this.#ctx.capBytes) {
      this.#bound += bytes
      return
    }
    this.#bound = null
    this.#bound = enforceSpoolCap(this.#ctx, this.#sizes)
  }
}

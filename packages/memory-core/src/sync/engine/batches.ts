/** sync-design §6: at most 8 MiB of plaintext per batch, a hard bound. */
export const MAX_BATCH_BYTES = 8 * 1024 * 1024

/** A pending item as the batch split sees it: its key and its ops' plaintext size. */
export interface SizedItem {
  readonly key: string
  readonly bytes: number
}

export class OversizedItemError extends Error {
  override readonly name = "OversizedItemError"
}

/**
 * Splits pending items between items, in capture order, so no batch exceeds `limit` plaintext
 * bytes. An item that alone exceeds the bound is refused here; the item store must slice it by
 * version range before it reaches the push path.
 */
export function splitBatches<T extends SizedItem>(items: readonly T[], limit = MAX_BATCH_BYTES): T[][] {
  const batches: T[][] = []
  let current: T[] = []
  let size = 0
  for (const item of items) {
    const bytes = item.bytes
    if (bytes > limit) throw new OversizedItemError(`item ${item.key} (${bytes} bytes) exceeds the ${limit}-byte batch bound`)
    if (current.length > 0 && size + bytes > limit) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push(item)
    size += bytes
  }
  if (current.length > 0) batches.push(current)
  return batches
}

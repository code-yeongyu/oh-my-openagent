import { framedRecordBytes } from "../crypto/build.ts"
import { PLAINTEXT_LIMIT } from "../crypto/vendor/sync-format/stream.ts"

/** sync-design §6: at most 8 MiB of plaintext per batch, a hard bound the receiver enforces. */
export const MAX_BATCH_BYTES = PLAINTEXT_LIMIT.ops

/** A pending item as the batch split sees it: its key and its ops' plaintext size. */
export interface SizedItem {
  readonly key: string
  readonly bytes: number
}

/**
 * What one item takes of a batch's plaintext: its ops inside the record framing the sealer wraps
 * them in, which the receiver counts against the bound too (#12306). The sealer adds no record
 * besides the items' own (account/sealer.ts), so a batch's payload is exactly the sum of these.
 */
export const batchCost = (item: SizedItem): number => framedRecordBytes(item.key, item.bytes)

export interface PushPlan<T extends SizedItem> {
  readonly batches: readonly (readonly T[])[]
  /** Pending items left out of every batch, in capture order; they stay pending. */
  readonly held: readonly T[]
}

/**
 * Splits pending items between items, in capture order, so no batch's payload exceeds `limit`
 * plaintext bytes. An item that alone exceeds the bound is never sliced, truncated or sent: it is held back
 * whole, and so is every later op of its key, which builds on it (#12284). Every other item is
 * still batched, so one oversized item never stops the rest of the device's changes. `withheld` keys
 * (ops this device must not send) are held the same way, from their first op on.
 */
export function planBatches<T extends SizedItem>(
  items: readonly T[],
  limit = MAX_BATCH_BYTES,
  withheld: ReadonlySet<string> = new Set(),
): PushPlan<T> {
  const batches: T[][] = []
  const held: T[] = []
  const heldKeys = new Set<string>(withheld)
  let current: T[] = []
  let size = 0
  for (const item of items) {
    const bytes = batchCost(item)
    if (bytes > limit || heldKeys.has(item.key)) {
      heldKeys.add(item.key)
      held.push(item)
      continue
    }
    if (current.length > 0 && size + bytes > limit) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push(item)
    size += bytes
  }
  if (current.length > 0) batches.push(current)
  return { batches, held }
}

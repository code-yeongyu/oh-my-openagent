import type { WireItem } from "./journal"

/** sync-design §6: at most 8 MiB of plaintext per batch, a hard bound. */
export const MAX_BATCH_BYTES = 8 * 1024 * 1024

/** The plaintext bytes one item adds to a batch. */
export const itemBytes = (item: WireItem): number => Math.floor((item.ops.length * 3) / 4)

export interface PushPlan {
  readonly batches: readonly (readonly WireItem[])[]
  /** Pending items left out of every batch, in capture order; they stay pending. */
  readonly held: readonly WireItem[]
}

/**
 * Splits pending items between items, in capture order, so no batch exceeds `limit` plaintext
 * bytes. An item that alone exceeds the bound is never sliced, truncated or sent: it is held back
 * whole, and so is every later op of its key, which builds on it (#12284). Every other item is
 * still batched, so one oversized item never stops the rest of the device's changes. `withheld` keys
 * (ops this device must not send) are held the same way, from their first op on.
 */
export function planBatches(items: readonly WireItem[], limit = MAX_BATCH_BYTES, withheld: ReadonlySet<string> = new Set()): PushPlan {
  const batches: WireItem[][] = []
  const held: WireItem[] = []
  const heldKeys = new Set<string>(withheld)
  let current: WireItem[] = []
  let size = 0
  for (const item of items) {
    const bytes = itemBytes(item)
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

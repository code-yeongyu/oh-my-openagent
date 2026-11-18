// Item keys pass isSyncItemKey before they reach the working tree, the item store or git
// (#12147). A refused item is dropped on its own: the rest of its batch applies and the cursor
// advances, so one bad item never pauses or wedges a device. Every drop leaves a receipt, a log
// line with the key's byte length and the rule (never the key text), and an item a peer sent is
// also counted in EngineState.rejectedItems, which the cycle report carries. Capture drops count
// nothing: the same local file is reported again on every cycle while it exists.

import { isSyncItemKey } from "../item"
import type { EngineDeps } from "./engine-deps"
import type { SyncJournal } from "./journal"

type ItemSide = "receive" | "apply" | "render" | "capture"

export async function rejectItem(
  deps: EngineDeps,
  journal: SyncJournal,
  side: ItemSide,
  key: string,
  rule: string,
): Promise<void> {
  deps.log?.(`sync.item.rejected side=${side} len=${Buffer.byteLength(key, "utf8")} rule=${rule}`)
  if (side === "capture") return
  await journal.updateState({ rejectedItems: (await journal.state()).rejectedItems + 1 })
}

export async function acceptedItems<T extends { readonly key: string }>(
  deps: EngineDeps,
  journal: SyncJournal,
  side: ItemSide,
  items: readonly T[],
): Promise<T[]> {
  const kept: T[] = []
  for (const item of items) {
    const problem = isSyncItemKey(item.key)
    if (problem === null) kept.push(item)
    else await rejectItem(deps, journal, side, item.key, problem)
  }
  return kept
}

export async function acceptedKeys(
  deps: EngineDeps,
  journal: SyncJournal,
  side: ItemSide,
  keys: readonly string[],
): Promise<string[]> {
  return (
    await acceptedItems(
      deps,
      journal,
      side,
      keys.map((key) => ({ key })),
    )
  ).map((item) => item.key)
}

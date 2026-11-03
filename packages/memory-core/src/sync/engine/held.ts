// Items sync holds out of the push (#12284). An edit larger than one batch may carry is never
// journaled, sliced or truncated (apply.ts `capture`), and an op an older build already journaled
// at that size stays pending with every later op of its key (batches.ts `planBatches`). Each cycle
// records the keys it held; status() names them until none is left.

import { MAX_BATCH_BYTES, planBatches } from "./batches"
import type { EngineDeps } from "./engine-deps"
import type { SyncJournal } from "./journal"

export const batchBound = (deps: EngineDeps): number => deps.batchBytes ?? MAX_BATCH_BYTES

/** Records this cycle's held keys (`captured` plus the pending ops no batch can carry) and returns them. */
export async function recordHeld(deps: EngineDeps, journal: SyncJournal, captured: readonly string[]): Promise<readonly string[]> {
  const pending = planBatches((await journal.pending()).items, batchBound(deps)).held.map((item) => item.key)
  const keys = [...new Set([...captured, ...pending])].sort()
  const previous = (await journal.state()).held
  const held = keys.length === 0 ? null : { keys, since: previous?.since ?? deps.clock.now(), cycles: (previous?.cycles ?? 0) + 1 }
  await journal.updateState({ held })
  return keys
}

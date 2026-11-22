// Items sync holds out of the push (#12284), and the renders it owes because of them. An edit larger
// than one batch may carry is never journaled, sliced or truncated (local-capture.ts); an op an older
// build already queued at that size is wound back into its file first, and only ops this device
// cannot wind back stay pending, as `stuck`. Each cycle records the keys it held, which status()
// names until none is left. A peer's edit to a held key reaches the doc but not the file; the key is
// owed a render, which the first cycle after the hold ends performs (apply.ts).

import { createHash } from "node:crypto"

import { MAX_BATCH_BYTES, planBatches } from "./batches"
import type { EngineDeps } from "./engine-deps"
import { describeOversizedItems, type SyncFailure } from "./failure"
import type { HeldItems, OwedRender, SyncJournal } from "./journal"

export const batchBound = (deps: EngineDeps): number => deps.batchBytes ?? MAX_BATCH_BYTES

/** The held items as the failure a UI shows, with the cycle the hold began and how many cycles it has lasted. */
export const heldShown = (
  held: HeldItems,
  limitBytes: number,
): { readonly failure: SyncFailure; readonly since: number; readonly attempts: number } => ({
  failure: describeOversizedItems(held.keys, limitBytes, held.stuck ?? []),
  since: held.since,
  attempts: held.cycles,
})

/** What a held decision depends on: the working text and the item doc's version. */
export const heldPrint = (text: string | null, version: string): string =>
  `${createHash("sha256")
    .update(text === null ? "\u0000absent" : `t:${text}`)
    .digest("hex")}@${version}`

/**
 * Records this cycle's held keys and returns them: `captured` by fingerprint, plus the stuck ones (pending
 * ops no batch can carry and this device could not wind back, and the `withheld` keys it must not send).
 */
export async function recordHeld(
  deps: EngineDeps,
  journal: SyncJournal,
  captured: ReadonlyMap<string, string>,
  withheld: ReadonlySet<string>,
): Promise<readonly string[]> {
  const stuck = [
    ...new Set([
      ...planBatches((await journal.pending()).items, batchBound(deps), withheld).held.map((item) => item.key),
      ...withheld,
    ]),
  ].sort()
  const keys = [...new Set([...captured.keys(), ...stuck])].sort()
  const previous = (await journal.state()).held
  const held =
    keys.length === 0
      ? null
      : {
          keys,
          stuck,
          since: previous?.since ?? deps.clock.now(),
          cycles: (previous?.cycles ?? 0) + 1,
          prints: Object.fromEntries(captured),
        }
  await journal.updateState({ held })
  return keys
}

/** `owed` with `key` owed a render by `principals` (merged into an existing entry). */
export function oweRender(owed: readonly OwedRender[], key: string, principals: readonly string[]): OwedRender[] {
  const prior = owed.find((o) => o.key === key)
  const merged = [...new Set([...(prior?.principals ?? []), ...principals])].sort()
  return [...owed.filter((o) => o.key !== key), { key, principals: merged }].sort((a, b) => a.key.localeCompare(b.key))
}

/** `owed` without the keys a cycle rendered (or could never render here). */
export const dischargeOwed = (owed: readonly OwedRender[], keys: readonly string[]): OwedRender[] =>
  owed.filter((o) => !keys.includes(o.key))

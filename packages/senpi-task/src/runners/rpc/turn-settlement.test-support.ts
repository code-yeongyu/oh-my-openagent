import type { TurnSettlementScheduler } from "./turn-settlement"

export type ManualSettlementScheduler = {
  readonly scheduler: TurnSettlementScheduler
  /** Armed, not-yet-fired confirmations (0 or 1 in practice: the settlement arms one at a time). */
  readonly pending: () => number
  readonly nextDelay: () => number | undefined
  /** Fire the armed confirmation. Throws when none is armed. */
  readonly runNext: () => void
}

/**
 * A confirmation scheduler that never fires on its own: the test arms through the settlement and
 * fires the armed confirmation explicitly, so "the confirmation ran" is an observable checkpoint
 * instead of a wall-clock guess.
 */
export function createManualSettlementScheduler(): ManualSettlementScheduler {
  type Entry = { readonly run: () => void; readonly delay: number; cancelled: boolean; ran: boolean }
  const entries: Entry[] = []
  return {
    scheduler: (run, delay) => {
      const entry: Entry = { run, delay, cancelled: false, ran: false }
      entries.push(entry)
      return {
        cancel: () => {
          entry.cancelled = true
        },
      }
    },
    pending: () => entries.filter((entry) => !entry.cancelled && !entry.ran).length,
    nextDelay: () => entries.find((entry) => !entry.cancelled && !entry.ran)?.delay,
    runNext: () => {
      const entry = entries.find((candidate) => !candidate.cancelled && !candidate.ran)
      if (entry === undefined) throw new Error("no settle confirmation is armed")
      entry.ran = true
      entry.run()
    },
  }
}

/**
 * Drain the settlement's probe promise chain deterministically. The chain is
 * `Promise.resolve().then(probe).then(onState)` plus the settle/waiter continuations, so a bounded
 * microtask flush - never time - guarantees the handler ran after `runNext`.
 */
export async function flushSettlement(): Promise<void> {
  for (let round = 0; round < 5; round += 1) await Promise.resolve()
}

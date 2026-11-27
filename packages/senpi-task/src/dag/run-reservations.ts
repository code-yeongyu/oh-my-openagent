// This process's per-run reservations (#15125): one operation per run at a time, shared by every entry
// that takes or mutates a run (acquisitions, verbs, cancel, Stop, shutdown, revive folds).
import type { DagRunId } from "./types"

/** This process's claim on one run while an operation installs, re-enters or mutates it. */
export type DagRunReservation = {
  readonly runId: DagRunId
  readonly operation: string
  readonly release: () => void
}

/** Reservations a caller already holds for runs it hands to another step, which never releases them. */
export type DagRunHeldReservations = ReadonlyMap<DagRunId, DagRunReservation>

export type DagRunReservations = {
  /** Undefined when another operation of this process already holds the run. */
  readonly reserve: (runId: DagRunId, operation: string) => DagRunReservation | undefined
  readonly inFlight: (runId: DagRunId) => string | undefined
  readonly whenFree: (runId: DagRunId) => Promise<void>
  readonly whenAllFree: () => Promise<void>
}

export function createDagRunReservations(): DagRunReservations {
  const held = new Map<DagRunId, { readonly operation: string; readonly released: Promise<void> }>()
  return {
    reserve(runId, operation) {
      if (held.has(runId)) return undefined
      let markReleased = (): void => undefined
      const entry = { operation, released: new Promise<void>((resolve) => (markReleased = resolve)) }
      held.set(runId, entry)
      let open = true
      return {
        runId,
        operation,
        release: () => {
          if (!open) return
          open = false
          if (held.get(runId) === entry) held.delete(runId)
          markReleased()
        },
      }
    },
    inFlight: (runId) => held.get(runId)?.operation,
    whenFree: (runId) => held.get(runId)?.released ?? Promise.resolve(),
    whenAllFree: async () => {
      while (held.size > 0) await Promise.all([...held.values()].map((entry) => entry.released))
    },
  }
}

/** Waits until no other operation of this process holds the run, then reserves it for `operation`. */
export async function reserveWhenFree(
  reservations: DagRunReservations,
  runId: DagRunId,
  operation: string,
): Promise<DagRunReservation> {
  for (;;) {
    const reservation = reservations.reserve(runId, operation)
    if (reservation !== undefined) return reservation
    await reservations.whenFree(runId)
  }
}

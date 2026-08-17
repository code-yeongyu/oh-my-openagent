import type { ReflectionOutcome, ReservedRun } from "@oh-my-opencode/memory-core"

import type { ReservationStatePort } from "./run-finalization-types"

// The active check and the completion must be one step: between a plain readState and complete()
// another process can settle the run, and complete() rejects a run it no longer owns.
export async function completeReservationIfActive(
  reservation: ReservationStatePort,
  runId: string,
  outcome: ReflectionOutcome,
): Promise<{ readonly launch?: ReservedRun } | undefined> {
  if (reservation.completeIfActive !== undefined) return reservation.completeIfActive(runId, outcome)
  const active = (await reservation.readState()).active
  if (active?.runId !== runId) return undefined
  return reservation.complete(runId, outcome)
}

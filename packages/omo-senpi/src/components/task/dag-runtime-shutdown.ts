import type { DagRecovery, DagRunId } from "@oh-my-opencode/senpi-task/dag"

import {
  reserveWhenFree,
  type DagRunReservation,
  type DagRunReservations,
} from "../../../../senpi-task/src/dag/run-acquisition"
import type { OwnedScheduler } from "./dag-scheduler-registry"

/**
 * The runtime's committed-shutdown pause. It holds the reservation of every run it schedules and every
 * run of the session from before retirement until its pause is written (#15125), so no installation,
 * verb or cancel of this process can take one of them in between, or revive a settled one behind it.
 */
export function createShutdownPause(ports: {
  readonly sweeps: { close(): Promise<void> }
  readonly reservations: DagRunReservations
  readonly schedulers: Map<DagRunId, OwnedScheduler>
  readonly recovery: Pick<DagRecovery, "pauseRunsForShutdown">
  sessionId(): string | undefined
  sessionRuns(sessionId: string): readonly DagRunId[]
}) {
  const { schedulers } = ports
  return async (): Promise<void> => {
    await ports.sweeps.close()
    const sessionId = ports.sessionId()
    const runIds = new Set([...schedulers.keys(), ...(sessionId === undefined ? [] : ports.sessionRuns(sessionId))])
    const held = new Map(
      await Promise.all(
        [...runIds].map(
          async (runId) => [runId, await reserveWhenFree(ports.reservations, runId, "shutdown")] as const,
        ),
      ),
    )
    try {
      await retireAndPause(sessionId, held)
    } finally {
      for (const reservation of held.values()) reservation.release()
    }
  }

  async function retireAndPause(
    sessionId: string | undefined,
    held: ReadonlyMap<DagRunId, DagRunReservation>,
  ): Promise<void> {
    // #8020: a committed shutdown RETIRES the schedulers instead of cancelling them (that is what
    // `detach` does, and doing it here is what used to destroy a run on every session switch).
    // The frontier loop must have exited before the pause is persisted, otherwise a late admission
    // or settlement writes over the paused checkpoint. Retirement also drops the run from
    // `schedulers`, so the #8029 in-process probe (`isRunHeldInProcess`) reports it unheld and a
    // later recovery in this SAME process can reclaim it instead of skipping on a live lease.
    const retiring = [...schedulers]
    await Promise.all(retiring.map(([, owned]) => owned.scheduler.suspend()))
    // Each retired run settles here, so nothing it still holds is written after the pause below.
    await Promise.allSettled(retiring.map(([, owned]) => owned.running))
    for (const [runId, owned] of retiring) {
      if (schedulers.get(runId) === owned) schedulers.delete(runId)
    }
    if (sessionId !== undefined) ports.recovery.pauseRunsForShutdown(sessionId, held)
  }
}

import {
  createDagLeaseWatch,
  type DagLeaseWatchOptions,
  type DagRecoveryOutcome,
  type DagRunId,
} from "@oh-my-opencode/senpi-task/dag"

import type { ComponentLogger } from "../../extension/types"

export type RecoveryScope = {
  readonly sessionId: string
  readonly forkSourceSessionId?: string
}

/**
 * The runtime's recovery sweeps and the lease watches that re-run them. A run paused for the
 * predecessor host's shutdown is often still "held" when this host resumes the session (the old
 * process is draining while the new one starts); recovery runs once per session_start, so a watch on
 * the reported holder pid re-runs it once that host is gone.
 *
 * A claimed run belongs to no scheduler here until its installation is adopted, so a shutdown
 * `close`s recovery (no new sweep, no new lease watch), drains the sweeps still installing, and only
 * then cancels the watches; a real attach `open`s it again (#15125).
 */
export function createDagRecoverySweeps(ports: {
  readonly leaseWatch: DagLeaseWatchOptions
  readonly logger: ComponentLogger
  readonly install: (scope: RecoveryScope) => Promise<readonly DagRecoveryOutcome[]>
  readonly afterSweep: (sessionId: string) => void
  readonly activeSessionId: () => string | undefined
  readonly onRecovered: () => void
}) {
  const leaseWatch = createDagLeaseWatch(ports.leaseWatch)
  const leaseWatches = new Map<DagRunId, () => void>()
  const sweeps = new Set<Promise<readonly DagRecoveryOutcome[]>>()
  let open = true

  const cancelWatches = (): void => {
    for (const cancel of leaseWatches.values()) cancel()
    leaseWatches.clear()
    leaseWatch.dispose()
  }

  const watchLiveLease = (scope: RecoveryScope, runId: DagRunId, holderPid: number): void => {
    if (!open || leaseWatches.has(runId)) return
    // A live_lease naming our own pid means a scheduler in this runtime still holds the run: a watch on
    // our own pid could only fire once this process is gone.
    if (holderPid === process.pid) return
    ports.logger.warn("omo-senpi DAG run stays paused while its previous host exits; resuming once that pid is gone", {
      runId,
      holderPid,
      sessionId: scope.sessionId,
    })
    leaseWatches.set(
      runId,
      leaseWatch.watch(holderPid, () => {
        leaseWatches.delete(runId)
        if (ports.activeSessionId() !== scope.sessionId) return
        void recover(scope)
          .then(ports.onRecovered)
          .catch((error: unknown) => {
            ports.logger.error("omo-senpi DAG deferred recovery failed", {
              runId,
              error: error instanceof Error ? error.message : String(error),
            })
          })
      }),
    )
  }

  const sweep = async (scope: RecoveryScope): Promise<readonly DagRecoveryOutcome[]> => {
    const outcomes = await ports.install(scope)
    for (const outcome of outcomes) {
      if (outcome.kind !== "skipped" || outcome.reason !== "live_lease" || outcome.holderPid === undefined) continue
      watchLiveLease(scope, outcome.runId, outcome.holderPid)
    }
    ports.afterSweep(scope.sessionId)
    return outcomes
  }

  /** Each of this session's runs answered by the sweep; none while recovery is closed. */
  const recover = (scope: RecoveryScope): Promise<readonly DagRecoveryOutcome[]> => {
    if (!open) return Promise.resolve([])
    const running = sweep(scope).finally(() => sweeps.delete(running))
    sweeps.add(running)
    return running
  }

  return {
    recover,
    cancelWatches,
    open: (): void => {
      open = true
    },
    close: async (): Promise<void> => {
      open = false
      await Promise.allSettled([...sweeps])
      cancelWatches()
    },
  }
}

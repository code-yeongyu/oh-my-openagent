import type { DagFileStore } from "@oh-my-opencode/senpi-task/dag"

import type { ComponentLogger } from "../../extension/types"

/**
 * Schedules the once-per-runtime DAG retention sweep. Production defers it so session start never
 * pays for the directory walk; tests inject a synchronous `schedule` to drive it deterministically.
 */
export type DagRetentionSweepOptions = {
  readonly schedule?: (sweep: () => void) => void
}

export type DagRetentionSweepDeps = {
  readonly logger: ComponentLogger
  readonly retentionSweep?: DagRetentionSweepOptions
}

function deferPastSessionStart(sweep: () => void): void {
  const handle = setTimeout(sweep, 0)
  handle.unref?.()
}

/**
 * Reclaims terminal runs past `task.dag.retention_days`. The store decides what is expired; this
 * seam decides WHEN, and swallows failures because a stale checkpoint must never fail a session.
 */
export function scheduleDagRetentionSweep(store: DagFileStore, deps: DagRetentionSweepDeps): void {
  const schedule = deps.retentionSweep?.schedule ?? deferPastSessionStart
  schedule(() => {
    try {
      const pruned = store.pruneExpired()
      if (pruned.length > 0) deps.logger.info(`DAG retention reclaimed ${pruned.length} expired run(s)`)
    } catch (error) {
      deps.logger.warn(`DAG retention sweep failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

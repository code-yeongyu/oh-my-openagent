/** Descriptive facts about an in-flight run, published to rpc clients alongside the run id. */
export interface ActiveReflectionRunDetails {
  readonly trigger: string
  readonly category: string
  readonly model?: string
  readonly startedAt: string
}

export interface ActiveReflectionRun extends ActiveReflectionRunDetails {
  readonly runId: string
}

/**
 * Tracks which reflection runs are in flight per identity so the footer knows when to animate.
 * Runs are counted by id, not by a boolean, because a settle of one run must not cancel the
 * spinner while a second run for the same identity is still working.
 */
export interface ActiveReflectionRuns {
  start(identity: string, runId: string, details: ActiveReflectionRunDetails): void
  settle(identity: string, runId: string): void
  clear(identity: string): void
  isActive(identity: string): boolean
  /** The oldest in-flight run for the identity, or undefined when the identity is idle. */
  current(identity: string): ActiveReflectionRun | undefined
}

export function createActiveReflectionRuns(): ActiveReflectionRuns {
  const byIdentity = new Map<string, Map<string, ActiveReflectionRunDetails>>()

  return {
    start(identity, runId, details) {
      const runs = byIdentity.get(identity) ?? new Map<string, ActiveReflectionRunDetails>()
      runs.set(runId, details)
      byIdentity.set(identity, runs)
    },

    settle(identity, runId) {
      const runs = byIdentity.get(identity)
      if (runs === undefined) return
      runs.delete(runId)
      if (runs.size === 0) byIdentity.delete(identity)
    },

    clear(identity) {
      byIdentity.delete(identity)
    },

    isActive(identity) {
      return (byIdentity.get(identity)?.size ?? 0) > 0
    },

    current(identity) {
      const entry = byIdentity.get(identity)?.entries().next()
      if (entry === undefined || entry.done === true) return undefined
      const [runId, details] = entry.value
      return { runId, ...details }
    },
  }
}

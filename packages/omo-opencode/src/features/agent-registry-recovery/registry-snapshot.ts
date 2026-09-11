/**
 * Snapshot of the agent names OMO applied during its most recent config-hook
 * run, plus cooldown bookkeeping for stale-registry recovery.
 *
 * OpenCode materializes its per-instance Agent registry lazily from the shared
 * config object and caches it for the instance lifetime. If something queries
 * agents before OMO's async config hook finishes applying (instance recreation
 * after /connect, startup race), the registry freezes without OMO agents. The
 * snapshot records what the last successful application looked like so the
 * recovery checker can tell a healthy registry from a frozen one.
 */

let appliedAgentNames: string[] = []
let lastRecoveryAttemptAt = 0

export function recordAppliedRegistry(names: string[]): void {
  appliedAgentNames = [...names]
}

export function getAppliedRegistry(): readonly string[] {
  return appliedAgentNames
}

export function getLastRecoveryAttemptAt(): number {
  return lastRecoveryAttemptAt
}

export function markRecoveryAttempted(at: number): void {
  lastRecoveryAttemptAt = at
}

/** @internal For testing only */
export function _resetForTesting(): void {
  appliedAgentNames = []
  lastRecoveryAttemptAt = 0
}

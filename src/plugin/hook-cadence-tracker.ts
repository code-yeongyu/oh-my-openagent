import type { HookName } from "../config"
import type { CadenceGroup } from "./hook-cadence-groups"
import { resolveHookCadence } from "./hook-cadence-groups"

/**
 * Tracks turn counts per hook per session to implement cadence-based firing.
 * 
 * A hook with cadence N fires on turn 1, then every Nth turn after that.
 * For example, cadence=3 fires on turns 1, 4, 7, 10, etc.
 */

interface SessionHookCounters {
  [hookName: string]: number
}

export class HookCadenceTracker {
  private sessionCounters: Map<string, SessionHookCounters> = new Map()
  private groupConfig?: Partial<Record<CadenceGroup, number>>

  constructor(groupConfig?: Partial<Record<CadenceGroup, number>>) {
    this.groupConfig = groupConfig
  }

  /**
   * Increment the turn counter for a hook and check if it should fire.
   * 
   * @param hookName - The name of the hook
   * @param sessionID - The session identifier
   * @returns true if the hook should fire on this turn
   */
  shouldFire(hookName: HookName, sessionID: string): boolean {
    const cadence = resolveHookCadence(hookName, this.groupConfig)

    // Cadence of 1 means fire every turn (default behavior)
    if (cadence === 1) {
      return true
    }

    // Get or create session counters
    if (!this.sessionCounters.has(sessionID)) {
      this.sessionCounters.set(sessionID, {})
    }
    const counters = this.sessionCounters.get(sessionID)!

    // Increment turn counter for this hook
    counters[hookName] = (counters[hookName] ?? 0) + 1
    const turnCount = counters[hookName]

    // Fire on turn 1, then every Nth turn after that
    // Formula: turnCount === 1 || (turnCount - 1) % cadence === 0
    // Examples with cadence=3: 1, 4, 7, 10, 13, ...
    const shouldFire = turnCount === 1 || (turnCount - 1) % cadence === 0

    return shouldFire
  }

  /**
   * Clean up counters for a session when it's deleted or compacted.
   * 
   * @param sessionID - The session identifier to clean up
   */
  cleanupSession(sessionID: string): void {
    this.sessionCounters.delete(sessionID)
  }

  /**
   * Get the current turn count for a hook in a session (for testing/debugging).
   * 
   * @param hookName - The name of the hook
   * @param sessionID - The session identifier
   * @returns The current turn count, or 0 if not tracked
   */
  getTurnCount(hookName: HookName, sessionID: string): number {
    return this.sessionCounters.get(sessionID)?.[hookName] ?? 0
  }
}

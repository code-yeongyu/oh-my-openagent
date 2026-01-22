/**
 * Shared compaction state module
 * Tracks when compaction (summarization) occurs for each session
 * Used by todo-continuation-enforcer and sisyphus-orchestrator to implement cooldown
 */

// Map of sessionID -> last compaction timestamp
const compactionTimestamps = new Map<string, number>()

// Cooldown period: 1 minute after compaction, don't trigger todo/boulder continuation
export const POST_COMPACT_COOLDOWN_MS = 60000

/**
 * Record that a compaction occurred for a session
 */
export function markCompaction(sessionID: string): void {
  compactionTimestamps.set(sessionID, Date.now())
}

/**
 * Check if a session is in post-compaction cooldown
 * Returns true if we should skip todo/boulder continuation
 */
export function isInCompactionCooldown(sessionID: string): boolean {
  const lastCompact = compactionTimestamps.get(sessionID)
  if (!lastCompact) return false
  
  const elapsed = Date.now() - lastCompact
  return elapsed < POST_COMPACT_COOLDOWN_MS
}

/**
 * Get remaining cooldown time in milliseconds
 */
export function getCompactionCooldownRemaining(sessionID: string): number {
  const lastCompact = compactionTimestamps.get(sessionID)
  if (!lastCompact) return 0
  
  const elapsed = Date.now() - lastCompact
  return Math.max(0, POST_COMPACT_COOLDOWN_MS - elapsed)
}

/**
 * Clear compaction state for a session (e.g., when session is deleted)
 */
export function clearCompactionState(sessionID: string): void {
  compactionTimestamps.delete(sessionID)
}

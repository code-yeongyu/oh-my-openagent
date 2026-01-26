/**
 * Shared compaction state module
 * Tracks when compaction (summarization) occurs for each session
 * Used by todo-continuation-enforcer and sisyphus-orchestrator to implement cooldown
 * Also provides in-progress guard for bidirectional compaction prevention
 */

// Map of sessionID -> last compaction timestamp (for cooldown)
const compactionTimestamps = new Map<string, number>()

// Map of sessionID -> compaction start timestamp (for in-progress guard)
const compactionInProgress = new Map<string, number>()

// Cooldown period: 1 minute after compaction, don't trigger todo/boulder continuation
export const POST_COMPACT_COOLDOWN_MS = 60000

// In-progress timeout: 30 seconds max for compaction, auto-clear if exceeded (prevents leaks)
export const COMPACTION_IN_PROGRESS_TIMEOUT_MS = 30000

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

// ============================================================================
// In-Progress Guard (Bidirectional Compaction Prevention)
// ============================================================================

/**
 * Mark that a compaction is starting for a session.
 * Used to prevent double compaction when both onSummarize and Anthropic recovery trigger.
 */
export function markCompactionInProgress(sessionID: string): void {
  compactionInProgress.set(sessionID, Date.now())
}

/**
 * Clear the in-progress flag when compaction completes.
 */
export function clearCompactionInProgress(sessionID: string): void {
  compactionInProgress.delete(sessionID)
}

/**
 * Check if a compaction is currently in progress for a session.
 * Returns false if the in-progress marker has exceeded the timeout (auto-clears to prevent leaks).
 */
export function isCompactionInProgress(sessionID: string): boolean {
  const startTime = compactionInProgress.get(sessionID)
  if (!startTime) return false
  
  // Auto-clear if exceeded timeout (prevents leaks from crashed compactions)
  if (Date.now() - startTime > COMPACTION_IN_PROGRESS_TIMEOUT_MS) {
    compactionInProgress.delete(sessionID)
    return false
  }
  
  return true
}

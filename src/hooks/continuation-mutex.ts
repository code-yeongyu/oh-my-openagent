/**
 * Continuation Mutex
 * 
 * Prevents double-injection of BOULDER and TODO continuation prompts.
 * When one continuation source acquires the lock, the other is skipped.
 */

type ContinuationSource = "boulder" | "todo"

interface MutexState {
  heldBy: ContinuationSource | null
  acquiredAt: number
}

// In-memory mutex state per session
const mutexStates = new Map<string, MutexState>()

// Mutex auto-releases after 10 seconds to prevent deadlocks
const MUTEX_TTL_MS = 10000

/**
 * Try to acquire the continuation mutex for a session
 * @returns true if acquired, false if already held by another source
 */
export function tryAcquireContinuationMutex(sessionId: string, source: ContinuationSource): boolean {
  const now = Date.now()
  const state = mutexStates.get(sessionId)
  
  // Check if mutex is held and not expired
  if (state && state.heldBy && (now - state.acquiredAt) < MUTEX_TTL_MS) {
    // If same source, allow (idempotent)
    if (state.heldBy === source) {
      return true
    }
    // Different source, deny
    return false
  }
  
  // Acquire the mutex
  mutexStates.set(sessionId, {
    heldBy: source,
    acquiredAt: now,
  })
  
  return true
}

/**
 * Release the continuation mutex for a session
 */
export function releaseContinuationMutex(sessionId: string): void {
  mutexStates.delete(sessionId)
}

/**
 * Check who currently holds the mutex
 * @returns The source holding the mutex, or null if not held
 */
export function getContinuationMutexHolder(sessionId: string): ContinuationSource | null {
  const now = Date.now()
  const state = mutexStates.get(sessionId)
  
  if (!state || !state.heldBy) {
    return null
  }
  
  // Check if expired
  if ((now - state.acquiredAt) >= MUTEX_TTL_MS) {
    mutexStates.delete(sessionId)
    return null
  }
  
  return state.heldBy
}

/**
 * Check if mutex is held by a specific source
 */
export function isContinuationMutexHeldBy(sessionId: string, source: ContinuationSource): boolean {
  return getContinuationMutexHolder(sessionId) === source
}

/**
 * Clean up mutex state for a session (call on session.deleted)
 */
export function cleanupContinuationMutex(sessionId: string): void {
  mutexStates.delete(sessionId)
}

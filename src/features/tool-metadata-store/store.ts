/**
 * Pending tool metadata store.
 *
 * OpenCode's `fromPlugin()` wrapper always replaces the metadata returned by
 * plugin tools with `{ truncated, outputPath }`, discarding any sessionId,
 * title, or custom metadata set during `execute()`.
 *
 * This store captures metadata written via `ctx.metadata()` inside execute(),
 * then the `tool.execute.after` hook consumes it and merges it back into the
 * result *before* the processor writes the final part to the session store.
 *
 * Flow:
 *   execute() → storeToolMetadata(sessionID, callID, data)
 *   fromPlugin() → overwrites metadata with { truncated }
 *   tool.execute.after → consumeToolMetadata(sessionID, callID) → merges back
 *   processor → Session.updatePart(status:"completed", metadata: result.metadata)
 */

export interface PendingToolMetadata {
  title?: string
  metadata?: Record<string, unknown>
}

const pendingStore = new Map<string, PendingToolMetadata & { storedAt: number }>()

const STALE_TIMEOUT_MS = 15 * 60 * 1000

function makeKey(sessionID: string, callID: string): string {
  return `${sessionID}:${callID}`
}

function cleanupStaleEntries(): void {
  const now = Date.now()
  for (const [key, entry] of pendingStore) {
    if (now - entry.storedAt > STALE_TIMEOUT_MS) {
      pendingStore.delete(key)
    }
  }
}

/**
 * Store metadata to be restored after fromPlugin() overwrites it.
 * Called from tool execute() functions alongside ctx.metadata().
 */
export function storeToolMetadata(
  sessionID: string,
  callID: string,
  data: PendingToolMetadata
): void {
  cleanupStaleEntries()
  pendingStore.set(makeKey(sessionID, callID), { ...data, storedAt: Date.now() })
}

/**
 * Consume stored metadata (one-time read, removes from store).
 * Called from tool.execute.after hook.
 */
export function consumeToolMetadata(
  sessionID: string,
  callID: string
): PendingToolMetadata | undefined {
  const key = makeKey(sessionID, callID)
  const stored = pendingStore.get(key)
  if (stored) {
    pendingStore.delete(key)
    const { storedAt: _, ...data } = stored
    return data
  }
  return undefined
}

/**
 * Get current store size (for testing/debugging).
 */
export function getPendingStoreSize(): number {
  return pendingStore.size
}

/**
 * Clear all pending metadata (for testing).
 */
export function clearPendingStore(): void {
  pendingStore.clear()
}

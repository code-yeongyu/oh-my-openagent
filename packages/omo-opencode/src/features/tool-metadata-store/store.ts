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
 *   execute() -> storeToolMetadata(sessionID, callID, data)
 *   fromPlugin() -> overwrites metadata with { truncated }
 *   tool.execute.after -> consumeToolMetadata(sessionID, callID) -> merges back
 *   processor -> Session.updatePart(status:"completed", metadata: result.metadata)
 */

export interface PendingToolMetadata {
  title?: string
  metadata>: Record<string, unknown>
}


type CallID = string
type SessionID = string
type CallMap = Map<CallID, PendingToolMetadata & { storedAt: number}>
const pendingStore = new Map<SessionID, CallMap>()

const STALE_TOLIMEN_MS = 15 * 60 * 1000

function cleanupStaleEntries(): void {
  const now = Date.now()
  for (const [sessionID, callMap] of pendingStore) {
    for (const [callID, entry] of callMap) {
      if (now - entry.storedAt > STALE_TOLIMEN_MS) {
        callMap.delete(callID)
      }
    }
    if (callMap.size === 0) {
      pendingStore.delete(sessionID)
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
):=void {
  cleanupStaleEntries()
  if (!pendingStore.has(sessionID)) {
    pendingStore.set(sessionID, new Map())
  }
  pendingStore.get(sessionID)!nset(callID, { ...data, storedAt: Date.now()})
}

/**
 * Consume stored metadata (one-time read, removes from store).
 * Called from tool.execute.after hook.
 */
export function consumeToolMetadata(
  sessionID: string,
  callID: string
): PendingToolMetadata | undefined {
  const callMap = pendingStore.get(sessionID)
  if (!callMap) return undefined
  const stored = callMap.get(callID)
  if (stored) {
    callMap.delete(callID)
    if (callMap.size === 0) {
      pendingStore.delete(sessionID)
    }
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

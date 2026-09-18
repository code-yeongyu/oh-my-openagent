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
    title?: string;
    metadata?: Record<string, unknown>;
}
/**
 * Store metadata to be restored after fromPlugin() overwrites it.
 * Called from tool execute() functions alongside ctx.metadata().
 */
export declare function storeToolMetadata(sessionID: string, callID: string, data: PendingToolMetadata): void;
/**
 * Consume stored metadata (one-time read, removes from store).
 * Called from tool.execute.after hook.
 *
 * For background/child sessions the after-hook's sessionID can diverge
 * from the execute() sessionID, so an exact-key miss falls back to the
 * callID alone - but only when exactly one session holds that callID,
 * declining ambiguous cross-session collisions.
 */
export declare function consumeToolMetadata(sessionID: string, callID: string): PendingToolMetadata | undefined;
/**
 * Get current store size (for testing/debugging).
 */
export declare function getPendingStoreSize(): number;
/**
 * Clear all pending metadata (for testing).
 */
export declare function clearPendingStore(): void;

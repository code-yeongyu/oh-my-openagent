import { type CallOptions, DesktopEngineRpcError, DesktopServiceError } from "./rpc-client"
import type { Connection } from "./session-state"
import { CAPABILITIES_TIMEOUT_MS } from "./timeouts"

/**
 * Viewer metadata is best effort. Never revive a dead child just to paint the app, and never hold an
 * aborted tool call for it: `signal` cancels the read and the call then has no status. A reply that
 * arrives after `current()` moved to another connection is dropped.
 */
export async function readViewerStatus(
  connection: Connection | undefined,
  current: () => Connection | undefined,
  signal?: AbortSignal,
): Promise<unknown> {
  if (connection?.rpc.alive !== true || signal?.aborted === true) return undefined
  const options: CallOptions = { timeoutMs: CAPABILITIES_TIMEOUT_MS, ...(signal && { signal }) }
  try {
    const result = await connection.rpc.request("session.viewerStatus", {}, options)
    return current() === connection ? result : undefined
  } catch (error) {
    if (error instanceof DesktopEngineRpcError && error.rpcCode === -32601) return undefined
    if (error instanceof DesktopServiceError && error.code === "Cancelled" && signal !== undefined) return undefined
    throw error
  }
}

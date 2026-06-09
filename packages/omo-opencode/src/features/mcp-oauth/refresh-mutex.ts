import type { OAuthTokenData } from "./storage"

/**
 * Per-server OAuth refresh mutex to prevent concurrent refresh race conditions.
 *
 * When multiple operations need to refresh a token for the same server,
 * this ensures only one refresh request is made and all waiters receive
 * the same result.
 */

const ongoingRefreshes = new Map<string, Promise<OAuthTokenData>>()

/**
 * Execute a token refresh with per-server mutual exclusion.
 *
 * If a refresh is already in progress for the given server, this will
 * return the same promise to all concurrent callers. Once the refresh
 * completes (success or failure), the lock is released.
 *
 * @param serverUrl - The OAuth server URL (used as mutex key)
 * @param refreshFn - The actual refresh operation to execute
 * @returns Promise that resolves to the new token data
 */
export async function withRefreshMutex(
  serverUrl: string,
  refreshFn: () => Promise<OAuthTokenData>,
): Promise<OAuthTokenData> {
  const existing = ongoingRefreshes.get(serverUrl)
  if (existing) {
    return existing
  }

  const refreshPromise = refreshFn().finally(() => {
    ongoingRefreshes.delete(serverUrl)
  })

  ongoingRefreshes.set(serverUrl, refreshPromise)
  return refreshPromise
}

/**
 * Check if a refresh is currently in progress for a server.
 *
 * @param serverUrl - The OAuth server URL
 * @returns true if a refresh operation is active
 */
export function isRefreshInProgress(serverUrl: string): boolean {
  return ongoingRefreshes.has(serverUrl)
}

/**
 * Get the number of servers currently undergoing token refresh.
 *
 * @returns Number of active refresh operations
 */
export function getActiveRefreshCount(): number {
  return ongoingRefreshes.size
}

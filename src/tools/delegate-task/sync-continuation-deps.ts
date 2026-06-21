import { fetchSyncResult } from "./sync-result-fetcher"
import { pollSyncSession } from "./sync-session-poller"

export const syncContinuationDeps = {
  pollSyncSession,
  fetchSyncResult,
}

export type SyncContinuationDeps = typeof syncContinuationDeps

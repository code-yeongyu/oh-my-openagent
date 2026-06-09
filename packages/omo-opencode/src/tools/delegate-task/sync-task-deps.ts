import { createSyncSession } from "./sync-session-creator"
import { sendSyncPrompt } from "./sync-prompt-sender"
import { pollSyncSession } from "./sync-session-poller"
import { fetchSyncResult } from "./sync-result-fetcher"

export const syncTaskDeps = {
  createSyncSession,
  sendSyncPrompt,
  pollSyncSession,
  fetchSyncResult,
}

export type SyncTaskDeps = typeof syncTaskDeps

import { sendSyncPrompt } from "./sync-prompt-sender"
import { fetchSyncResult } from "./sync-result-fetcher"
import { createSyncSession } from "./sync-session-creator"
import { pollSyncSession } from "./sync-session-poller"

export const syncTaskDeps = {
  createSyncSession,
  sendSyncPrompt,
  pollSyncSession,
  fetchSyncResult,
}

export type SyncTaskDeps = typeof syncTaskDeps

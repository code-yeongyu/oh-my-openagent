import { isProviderExhaustionFallbackEligible } from "@oh-my-opencode/model-core"
import { createSyncSession } from "./sync-session-creator"
import { sendSyncPrompt } from "./sync-prompt-sender"
import { pollSyncSession } from "./sync-session-poller"
import { fetchSyncResult } from "./sync-result-fetcher"

export type SyncTaskDeps = {
  readonly createSyncSession: typeof createSyncSession
  readonly sendSyncPrompt: typeof sendSyncPrompt
  readonly pollSyncSession: typeof pollSyncSession
  readonly fetchSyncResult: typeof fetchSyncResult
  readonly isProviderExhaustionFallbackEligible?: typeof isProviderExhaustionFallbackEligible
}

export const syncTaskDeps: SyncTaskDeps = {
  createSyncSession,
  sendSyncPrompt,
  pollSyncSession,
  fetchSyncResult,
  isProviderExhaustionFallbackEligible,
}

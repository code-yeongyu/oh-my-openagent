// The onboarding RPC methods and the session-history tool register in the entry bundle, but the scan itself
// (transcript discovery, parsing, digests) ships as the `#omo-session-history-runtime` sidecar, imported on the
// first scan, so sessions that never onboard load none of it.

import type * as SessionHistoryRuntime from "./session-history/runtime"

export type SessionHistoryRuntimeModule = Pick<
  typeof SessionHistoryRuntime,
  "createSessionDigestStore" | "createSessionHistoryScanner" | "scanSessionHistory"
>
export type SessionHistoryRuntimeLoader = () => Promise<SessionHistoryRuntimeModule>

export const SESSION_HISTORY_RUNTIME_ARTIFACT = "extensions/omo-session-history.js"

/** One shared import per process; a failed import is not cached, so the next scan retries. */
export function createSessionHistoryRuntimeLoader(
  importRuntime: () => Promise<SessionHistoryRuntimeModule>,
): SessionHistoryRuntimeLoader {
  let pending: Promise<SessionHistoryRuntimeModule> | undefined
  return () => {
    pending ??= importRuntime().catch((error: unknown) => {
      pending = undefined
      throw new Error(sessionHistoryRuntimeLoadFailure(error), { cause: error })
    })
    return pending
  }
}

export const loadSessionHistoryRuntime: SessionHistoryRuntimeLoader = createSessionHistoryRuntimeLoader(
  () => import("#omo-session-history-runtime"),
)

export function sessionHistoryRuntimeLoadFailure(error: unknown): string {
  const cause = error instanceof Error ? error.message : String(error)
  return `The session history scan is unavailable: its runtime (${SESSION_HISTORY_RUNTIME_ARTIFACT}) failed to load: ${cause}. This build's plugin payload is incomplete; reinstall omo, then start a new session.`
}

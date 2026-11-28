// The onboarding RPC methods and the session-history tool register in the entry bundle, but the scan itself
// (transcript discovery, parsing, digests) ships as the `#omo-session-history-runtime` sidecar, imported on the
// first scan, so sessions that never onboard load none of it.

import type * as SessionHistoryRuntime from "./session-history/runtime"

import { reinstallStep } from "../reinstall/reinstall-step"

export type SessionHistoryRuntimeModule = Pick<
  typeof SessionHistoryRuntime,
  "createSessionDigestStore" | "createSessionHistoryScanner" | "scanSessionHistory"
>
export type SessionHistoryRuntimeLoader = () => Promise<SessionHistoryRuntimeModule>

export const SESSION_HISTORY_RUNTIME_ARTIFACT = "extensions/omo-session-history.js"

/** The sidecar did not load. Its message is built from fixed words (artifact and remedy), so callers may show it. */
export class SessionHistoryRuntimeUnavailable extends Error {}

/** One shared import per process; a failed import is not cached, so the next scan retries. */
export function createSessionHistoryRuntimeLoader(
  importRuntime: () => Promise<SessionHistoryRuntimeModule>,
): SessionHistoryRuntimeLoader {
  let pending: Promise<SessionHistoryRuntimeModule> | undefined
  return () => {
    pending ??= importRuntime().catch((error: unknown) => {
      pending = undefined
      throw new SessionHistoryRuntimeUnavailable(sessionHistoryRuntimeLoadFailure(), { cause: error })
    })
    return pending
  }
}

export const loadSessionHistoryRuntime: SessionHistoryRuntimeLoader = createSessionHistoryRuntimeLoader(
  () => import("#omo-session-history-runtime"),
)

/** Names the missing artifact and the remedy. The import error stays in `cause`: it names local paths (#15352). */
export function sessionHistoryRuntimeLoadFailure(): string {
  return `The session history scan is unavailable: its runtime (${SESSION_HISTORY_RUNTIME_ARTIFACT}) failed to load. Part of this omo installation is missing; ${reinstallStep()}, then start a new session.`
}

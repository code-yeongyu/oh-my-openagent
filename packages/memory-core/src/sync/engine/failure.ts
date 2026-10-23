// Why a sync cycle failed, in the words a person reads in the TUI footer or the desktop: what kind
// of failure it is, what happened, and what to do about it (omo #10637). The engine keeps the
// latest failure until a cycle succeeds; the raw error text stays in the log, never in the status.

import { StrandedGitLockError } from "../../git/repo-lock-sweep"
import { SyncAuthError, SyncHttpError, SyncNetworkError } from "./adapters/http-transport"

export type SyncFailure =
  | { readonly kind: "stranded_lock"; readonly paths: readonly string[]; readonly reason: string; readonly action: string }
  | { readonly kind: "auth_expired"; readonly reason: string; readonly action: string }
  | { readonly kind: "offline"; readonly reason: string; readonly action: string }
  | { readonly kind: "unknown"; readonly reason: string; readonly action: string }

export type SyncFailureKind = SyncFailure["kind"]

const AUTH_EXPIRED: SyncFailure = {
  kind: "auth_expired",
  reason: "This device's OmO sign-in has expired or was refused, so memory sync cannot reach your account.",
  action: "Sign in to OmO again.",
}

const OFFLINE: SyncFailure = {
  kind: "offline",
  reason: "Memory sync cannot reach the OmO sync service.",
  action: "Check your internet connection. Sync resumes on its own once the service is reachable.",
}

/**
 * A network blip retries on the next cycle without alarming anyone: an offline failure is shown
 * only once this many cycles in a row have failed with it. Every other kind is shown at once.
 */
export const OFFLINE_SHOWN_AFTER_ATTEMPTS = 3

export function isFailureShown(kind: SyncFailureKind, attempts: number): boolean {
  return kind !== "offline" || attempts >= OFFLINE_SHOWN_AFTER_ATTEMPTS
}

const UNKNOWN: SyncFailure = {
  kind: "unknown",
  reason: "Memory sync stopped on an unexpected error.",
  action: "Sync retries on its own. If this stays, restart OmO; the error is in the memory log.",
}

export function describeSyncFailure(error: unknown): SyncFailure {
  if (error instanceof StrandedGitLockError) {
    return {
      kind: "stranded_lock",
      paths: error.paths,
      reason: "A git lock file left in the memory repository blocks sync, and OmO did not remove it on its own.",
      action: error.paths.length === 1
        ? `If no other session is working on this memory, run /memory unlock ${error.paths[0]}, or restart OmO.`
        : `If no other session is working on this memory, run /memory unlock for each: ${error.paths.join(", ")}; or restart OmO.`,
    }
  }
  if (error instanceof SyncAuthError || (error instanceof SyncHttpError && error.status === 401)) return AUTH_EXPIRED
  if (error instanceof SyncNetworkError || (error instanceof SyncHttpError && error.transient)) return OFFLINE
  return UNKNOWN
}

// Why a sync cycle failed, in the words a person reads in the TUI footer or the desktop: what kind
// of failure it is, what happened, and what to do about it (omo #10637). The engine keeps the
// latest failure until a cycle succeeds; the raw error text stays in the log, never in the status.
// An item held out of the push (#12284) is shown the same way while it is held, though every other
// item keeps syncing, because only the person can end it.

import { StrandedGitLockError } from "../../git/repo-lock-sweep"
import { SyncAuthError, SyncHttpError, SyncNetworkError } from "./adapters/http-transport"

export type SyncFailure =
  | { readonly kind: "stranded_lock"; readonly paths: readonly string[]; readonly reason: string; readonly action: string }
  | { readonly kind: "auth_expired"; readonly reason: string; readonly action: string }
  | { readonly kind: "offline"; readonly reason: string; readonly action: string }
  | { readonly kind: "unknown"; readonly reason: string; readonly action: string }
  | {
      readonly kind: "oversized_item"
      readonly keys: readonly string[]
      /** The keys whose queued change this device cannot wind back: shrinking them will not help. */
      readonly stuck: readonly string[]
      readonly limitBytes: number
      readonly reason: string
      readonly action: string
    }

export type SyncFailureKind = SyncFailure["kind"]

const AUTH_EXPIRED: SyncFailure = {
  kind: "auth_expired",
  reason: "This device's OmO sign-in has expired or was refused, so memory sync cannot reach your account.",
  action: "Sign in to OmO again from the OmO desktop app on this computer.",
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

const MIB = 1024 * 1024
const sizeText = (bytes: number): string => (bytes % MIB === 0 ? `${bytes / MIB} MiB` : `${bytes} bytes`)

const nameKeys = (keys: readonly string[]): string => (keys.length <= 3 ? keys.join(", ") : `${keys.slice(0, 3).join(", ")} and ${keys.length - 3} more`)

/**
 * The items sync holds back because one change to each is larger than a batch may carry. A stuck key
 * (a queued change this device cannot wind back) gets an action that promises no recovery.
 */
export function describeOversizedItems(keys: readonly string[], limitBytes: number, stuck: readonly string[] = []): SyncFailure {
  const limit = sizeText(limitBytes)
  const fixable = keys.filter((key) => !stuck.includes(key))
  const shrink = fixable.length === 0
    ? ""
    : `Shrink or split ${nameKeys(fixable)} to stay under ${limit}; ${fixable.length === 1 ? "it syncs" : "each syncs"} on its own once it fits.`
  const kept = stuck.length === 0
    ? ""
    : `${nameKeys(stuck)} cannot be sent from this device even if made smaller; the change stays on this device, and the memory log has the detail.`
  return {
    kind: "oversized_item",
    keys,
    stuck,
    limitBytes,
    reason: fixable.length === 0
      ? `A change queued on this device for ${keys.length === 1 ? "one memory file" : `${keys.length} memory files`} cannot be sent from it. Every other memory keeps syncing.`
      : keys.length === 1
      ? `A change to one memory file is larger than the ${limit} sync limit, so that file is not synced. Every other memory keeps syncing.`
      : `Changes to ${keys.length} memory files are larger than the ${limit} sync limit, so those files are not synced. Every other memory keeps syncing.`,
    action: [shrink, kept].filter((part) => part !== "").join(" "),
  }
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

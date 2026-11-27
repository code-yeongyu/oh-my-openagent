// Why a sync cycle failed, in the words a person reads in the TUI footer or the desktop: what kind
// of failure it is, what happened, and what to do about it (omo #10637). The engine keeps the
// latest failure until a cycle succeeds; the raw error text stays in the log, never in the status.
// An item held out of the push (#12284) is shown the same way while it is held, though every other
// item keeps syncing, because only the person can end it. Any other error carries its safe cause
// (#13635), and the ones the engine can name honestly get their own kind.

import { StrandedGitLockError } from "../../git/repo-lock-sweep"
import { SyncAuthError, SyncHttpError, SyncNetworkError } from "./adapters/http-transport"
import { causeOf, type SyncFailureCause, type SyncStage } from "./failure-cause"

export type SyncFailure =
  | {
      readonly kind: "stranded_lock"
      readonly paths: readonly string[]
      readonly reason: string
      readonly action: string
    }
  | { readonly kind: "auth_expired"; readonly reason: string; readonly action: string }
  | { readonly kind: "offline"; readonly reason: string; readonly action: string }
  | {
      /** A full disk, a refused write, a service refusal, else unknown: each says what failed in `cause`. */
      readonly kind: "disk_full" | "no_write_access" | "service_refused" | "unknown"
      readonly reason: string
      readonly action: string
      readonly cause: SyncFailureCause
    }
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

const UNKNOWN = {
  kind: "unknown",
  reason: "Memory sync stopped on an unexpected error.",
  action: "Sync retries on its own. If this stays, restart OmO; run it with OMO_DEBUG=1 to log the full error.",
} as const

const DISK_FULL = {
  kind: "disk_full",
  reason: "The disk is full, so memory sync cannot save its changes.",
  action: "Free up disk space on this computer. Sync retries on its own.",
} as const

const PERMISSION_DENIED = {
  kind: "no_write_access",
  reason: "Memory sync is not allowed to write a file it needs (permission denied).",
  action:
    "Make sure your user account owns the memory folder and OmO's data folder and can write to them; with OMO_DEBUG=1 the memory log names the file. Sync retries on its own.",
} as const

const READ_ONLY = {
  kind: "no_write_access",
  reason: "Memory sync cannot write because the disk holding its files is read-only.",
  action:
    "Make the memory folder writable again; with OMO_DEBUG=1 the memory log names the file. Sync retries on its own.",
} as const

const FULL_CODES: ReadonlySet<string> = new Set(["ENOSPC", "EDQUOT"])
const DENIED_CODES: ReadonlySet<string> = new Set(["EACCES", "EPERM"])

/** An error that is not a lock, a sign-in or the network, told apart by its cause where the engine can name it. */
function describeCausedFailure(error: unknown, stage: SyncStage): SyncFailure {
  const cause = causeOf(error, stage)
  const code = cause.code ?? ""
  if (FULL_CODES.has(code)) return { ...DISK_FULL, cause }
  if (DENIED_CODES.has(code)) return { ...PERMISSION_DENIED, cause }
  if (code === "EROFS") return { ...READ_ONLY, cause }
  if (error instanceof SyncHttpError)
    return {
      kind: "service_refused",
      reason: "The OmO sync service refused a request from this device.",
      action:
        "Sync retries on its own. If this stays, update OmO on this device; with OMO_DEBUG=1 the memory log has the detail.",
      cause,
    }
  return { ...UNKNOWN, cause }
}

const MIB = 1024 * 1024
const sizeText = (bytes: number): string => (bytes % MIB === 0 ? `${bytes / MIB} MiB` : `${bytes} bytes`)

const nameKeys = (keys: readonly string[]): string =>
  keys.length <= 3 ? keys.join(", ") : `${keys.slice(0, 3).join(", ")} and ${keys.length - 3} more`

/**
 * The items sync holds back because one change to each is larger than a batch may carry. A stuck key
 * (a queued change this device cannot wind back) gets an action that promises no recovery.
 */
export function describeOversizedItems(
  keys: readonly string[],
  limitBytes: number,
  stuck: readonly string[] = [],
): SyncFailure {
  const limit = sizeText(limitBytes)
  const fixable = keys.filter((key) => !stuck.includes(key))
  const shrink =
    fixable.length === 0
      ? ""
      : `Shrink or split ${nameKeys(fixable)} to stay under ${limit}; ${fixable.length === 1 ? "it syncs" : "each syncs"} on its own once it fits.`
  const kept =
    stuck.length === 0
      ? ""
      : `${nameKeys(stuck)} cannot be sent from this device even if made smaller; the change stays on this device, and with OMO_DEBUG=1 the memory log has the detail.`
  return {
    kind: "oversized_item",
    keys,
    stuck,
    limitBytes,
    reason:
      fixable.length === 0
        ? `A change queued on this device for ${keys.length === 1 ? "one memory file" : `${keys.length} memory files`} cannot be sent from it. Every other memory keeps syncing.`
        : keys.length === 1
          ? `A change to one memory file is larger than the ${limit} sync limit, so that file is not synced. Every other memory keeps syncing.`
          : `Changes to ${keys.length} memory files are larger than the ${limit} sync limit, so those files are not synced. Every other memory keeps syncing.`,
    action: [shrink, kept].filter((part) => part !== "").join(" "),
  }
}

export function describeSyncFailure(error: unknown, stage: SyncStage): SyncFailure {
  if (error instanceof StrandedGitLockError) {
    return {
      kind: "stranded_lock",
      paths: error.paths,
      reason: "A git lock file left in the memory repository blocks sync, and OmO did not remove it on its own.",
      action:
        error.paths.length === 1
          ? `If no other session is working on this memory, run /memory unlock ${error.paths[0]}, or restart OmO.`
          : `If no other session is working on this memory, run /memory unlock for each: ${error.paths.join(", ")}; or restart OmO.`,
    }
  }
  if (error instanceof SyncAuthError || (error instanceof SyncHttpError && error.status === 401)) return AUTH_EXPIRED
  if (error instanceof SyncNetworkError || (error instanceof SyncHttpError && error.transient)) return OFFLINE
  return describeCausedFailure(error, stage)
}

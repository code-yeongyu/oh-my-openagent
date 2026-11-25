import { homedir } from "node:os"
import { type CredentialStore, credentialId } from "../keystore"
import { type Credentials, serviceOrigin } from "../protocol"
import { readRecoveryClock, type RecoveryClock } from "../recovery-clock"
import { eligibleAttempt } from "../refresh-attempt"
import { type SignedOutMarker, readSignedOutMarker, signedOutMarkerPath } from "../signed-out-marker"
import { type CallOutcome, ok, refusedWith } from "./outcome"

// account.show (first-party design 6.4): the stored credential, the signed-out marker and the sync pin, read here and
// nowhere else; nothing reaches the account service (omo#13440). The value is the record `omo account show` prints.

export type SyncState = "joined" | "not_joined" | "corrupt_pin"

export type AccountShown =
  | {
      readonly signedIn: true
      readonly device: { readonly id: string; readonly name: string }
      readonly refreshState: string
      readonly sync?: SyncState
      readonly storage?: string
    }
  | {
      readonly signedIn: false
      readonly signedOut?: SignedOutMarker
      readonly sync?: SyncState
      readonly storage?: string
    }

export type ShowDependencies = {
  readonly api: string
  readonly store: Pick<CredentialStore, "read" | "storage">
  readonly home?: string
  /** Whether this device joined memory sync for an account: its trust pin, read by the caller's memory core. */
  readonly syncState: (account: string) => Promise<SyncState>
  /** Defaults to the OS recovery clock. An uncertain fence is expired when this clock cannot prove the attempt. */
  readonly recoveryClock?: RecoveryClock
}

const isAttemptRecord = (value: unknown): value is { readonly state?: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// `uncertain` is in progress only while a protocol-2 attempt is still eligible on this boot. No attempt, an exhausted
// attempt, or one the recovery clock rejects (deadline, reboot, clock loss) is terminal: `omo token` already ends that
// session, and the desktop must not treat it as a renewal still running.
async function reportedRefreshState(current: Credentials, origin: string, clock: RecoveryClock): Promise<string> {
  if (current.refreshState !== "uncertain") return current.refreshState ?? "ok"
  const attempt = current.refreshAttempt
  if (attempt === undefined || attempt === null) return "expired"
  if (isAttemptRecord(attempt) && attempt.state === "exhausted") return "expired"
  if (current.owner === undefined) return "expired"
  const eligible = eligibleAttempt(attempt, serviceOrigin(origin), current.owner, current.refreshToken, await clock())
  return eligible === null ? "expired" : "uncertain"
}

export async function accountShow(
  deps: ShowDependencies,
  input: { readonly account?: string },
): Promise<CallOutcome<AccountShown, { readonly code: "invalid_account" }>> {
  if (input.account === "") return refusedWith({ code: "invalid_account" })
  const current = await deps.store.read()
  const sync = input.account === undefined ? {} : { sync: await deps.syncState(input.account) }
  // Where the shared sign-in lives, or would be kept (#7185b): the OS store, or Linux's private state file.
  const storage = deps.store.storage === undefined ? {} : { storage: deps.store.storage() }
  if (current !== null)
    return ok({
      signedIn: true,
      device: { id: current.device.id, name: current.device.name },
      refreshState: await reportedRefreshState(current, deps.api, deps.recoveryClock ?? readRecoveryClock),
      ...sync,
      ...storage,
    })
  const marker = await readSignedOutMarker(signedOutMarkerPath(deps.home ?? homedir(), credentialId(deps.api)))
  return ok({ signedIn: false, ...(marker === null ? {} : { signedOut: marker }), ...sync, ...storage })
}

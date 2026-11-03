import { homedir } from "node:os"
import { withCredentialLock } from "./credential-lock"
import { signInHint } from "./accounts-gate"
import type { CredentialOwner } from "./credential-owner"
import { CredentialIdentityChanged, credentialId, type CredentialStore, CredentialStoreError, InvalidCredentialState } from "./keystore"
import {
  ApiRefusal, type ChooseDevice, type Credentials, deviceListSchema, jsonRequest, parseReply,
  refusalGuidance, refusalMessage, requestApi, RequestFailure, serviceOrigin, SignInError, tokenSchema,
} from "./protocol"
import { clearSignedOutMarker, readSignedOutMarker, signedOutMarkerPath, writeSignedOutMarker } from "./signed-out-marker"

export class SessionEnded extends SignInError {
  constructor(message: string, readonly deviceRevoked: boolean, readonly code: string) { super(message) }
}

const DEVICE_REVOKING_REFUSALS = new Set(["account_deleted", "reauth_required", "device_revoked"])

/**
 * A stored principal whose private keys are about to be discarded (#12280), or a stored item that
 * could not be read when a save replaced it. The hook retires that principal's memory-sync pin; it
 * never throws, so a failure to retire never blocks the discard.
 */
export type DiscardedCredential =
  | {
      readonly kind: "credential"
      readonly deviceId: string
      readonly accountId: string | undefined
      readonly owner: CredentialOwner | undefined
      readonly cause: "refused" | "forget" | "logout" | "replaced"
    }
  | { readonly kind: "unreadable" }

export type BeforeKeysDiscarded = ((discarded: DiscardedCredential) => Promise<void>) & {
  /** Whether a sign-in that names no account should have it read before logout revokes the device. */
  readonly wantsAccount?: () => Promise<boolean>
}

export const discardedOf = (credentials: Credentials, cause: "refused" | "forget" | "logout" | "replaced"): DiscardedCredential => ({
  kind: "credential", deviceId: credentials.device.id, accountId: credentials.accountId, owner: credentials.owner, cause,
})

export function createSession(options: {
  readonly api: string
  readonly store: CredentialStore
  readonly home?: string
  readonly signal?: AbortSignal
  readonly now?: () => number
  /** Runs inside the credential lock immediately before a stored principal's keys are discarded. */
  readonly beforeKeysDiscarded: BeforeKeysDiscarded
}) {
  const api = serviceOrigin(options.api)
  const now = options.now ?? Date.now
  const { store, signal, beforeKeysDiscarded } = options
  const markerPath = signedOutMarkerPath(options.home ?? homedir(), credentialId(api))
  async function locked<T>(action: () => Promise<T>): Promise<T> {
    signal?.throwIfAborted()
    return withCredentialLock(
      api,
      async () => {
        signal?.throwIfAborted()
        return action()
      },
      options.home,
    )
  }
  const request = (path: string, init: RequestInit) => requestApi(api, path, init, signal)
  /** The account a token's sign-in belongs to; undefined when the service does not say (never blocks logout). */
  const accountOf = async (access: string): Promise<string | undefined> => {
    const body = await request("/v1/me", { headers: { authorization: `Bearer ${access}` } }).catch(() => null)
    const id = typeof body === "object" && body !== null && "account" in body && typeof body.account === "object" && body.account !== null && "id" in body.account ? body.account.id : undefined
    return typeof id === "string" && id !== "" ? id : undefined
  }
  async function refreshed(current: Credentials): Promise<Credentials> {
    // Legacy state cannot prove the original key, identity and age. Only protocol-2's owned
    // transaction can recover; neither a draft key nor a new key authorizes a legacy resend.
    if (current.refreshState === "uncertain" || current.refreshAttempt !== undefined) {
      throw new SessionEnded(`Refresh recovery can no longer be proved safe. ${signInHint("again")}`, false, "refresh_recovery_expired")
    }
    if (Date.parse(current.accessTokenExpiresAt) > now() + 30_000) return current
    await store.write({ ...current, refreshState: "uncertain" })
    try {
      const tokens = parseReply(tokenSchema, await request("/v1/session/refresh", jsonRequest({ refreshToken: current.refreshToken })))
      const successor = { ...current, ...tokens }
      await store.write(successor)
      return successor
    } catch (error) {
      if (error instanceof CredentialStoreError) throw error
      if (error instanceof ApiRefusal && error.status < 500 &&
          ["unauthorized", "account_deleted", "reauth_required", "invalid_grant", "device_revoked"].includes(error.code)) {
        await beforeKeysDiscarded(discardedOf(current, "refused"))
        await store.clear()
        throw new SessionEnded(
          error.code === "reauth_required"
            ? `This session was ended because its refresh token was reused. ${signInHint("again")}`
            : refusalMessage(refusalGuidance(error.code, error.status)),
          DEVICE_REVOKING_REFUSALS.has(error.code),
          error.code,
        )
      }
      if ((error instanceof RequestFailure && error.notSent) ||
          (error instanceof ApiRefusal && error.status === 429 && error.code === "rate_limited")) {
        await store.write(current)
        throw error
      }
      throw new SessionEnded(`The refresh outcome is unknown. Saved credentials and keys were retained. ${signInHint("again")}`, false, "refresh_recovery_expired")
    }
  }
  async function snapshot(): Promise<Credentials | null> {
    return locked(async () => {
      const current = await store.read()
      return current === null ? null : refreshed(current)
    })
  }
  return {
    request,
    signal,
    transaction: locked,
    async ready() { await store.read() },
    async save(value: Credentials) {
      await locked(async () => {
        let stored: Credentials | null
        try {
          stored = await store.readAuthoritative()
        } catch (error) {
          if (!(error instanceof InvalidCredentialState)) throw error
          await beforeKeysDiscarded({ kind: "unreadable" })
          stored = null
        }
        if (stored !== null && stored.device.id !== value.device.id) await beforeKeysDiscarded(discardedOf(stored, "replaced"))
        await store.write(value)
        await clearSignedOutMarker(markerPath)
      })
    },
    /** The marker an explicit `omo logout` left, or null; only an empty store makes it meaningful. */
    signedOutMarker: () => readSignedOutMarker(markerPath),
    clearSignedOutMarker: () => clearSignedOutMarker(markerPath),
    async update<T>(action: (current: Credentials | null) => Promise<T>, options: { readonly replaceInvalid?: boolean } = {}): Promise<T> {
      return locked(async () => {
        let current: Credentials | null
        try {
          // Under the lock only a read started now is authoritative: a coalesced read may predate another writer.
          current = await store.readAuthoritative()
        } catch (error) {
          if (!options.replaceInvalid || !(error instanceof InvalidCredentialState)) throw error
          current = null
        }
        return action(current)
      })
    },
    /**
     * Deletes the item without reading it (a corrupt or locked item must still be removable, with one
     * native call), so it cannot name the account whose pin to retire: `omo account forget --device`
     * and `logout` read first and retire; this one leaves the pin (a stale pin is harmless for keys).
     */
    async forget(): Promise<void> {
      await locked(() => store.clear())
    },
    accessSnapshot: snapshot,
    async logout(): Promise<boolean> {
      return locked(async () => {
        let current: Credentials | null = null
        let account: string | undefined
        try {
          current = await store.readAuthoritative()
          if (current !== null) {
            if (current.refreshState === "uncertain") return false
            const access = Date.parse(current.accessTokenExpiresAt) <= now() ? (await refreshed(current)).accessToken : current.accessToken
            if (current.accountId === undefined && current.owner === undefined && await beforeKeysDiscarded.wantsAccount?.() === true) {
              account = await accountOf(access)
            }
            await request(`/v1/devices/${encodeURIComponent(current.device.id)}`, {
              method: "DELETE", headers: { authorization: `Bearer ${access}` },
            })
          }
          return true
        } catch (error) {
          if (error instanceof SessionEnded) return error.deviceRevoked
          if (error instanceof SignInError) return false
          throw error
        } finally {
          // Marker first: it only counts once the store is empty, so an unlocked reader never sees an empty store
          // without it, and a failed marker write leaves the credentials in place instead of half-signing-out.
          await writeSignedOutMarker(markerPath, current?.device.id ?? null)
          // A refresh refusal inside this logout already cleared the store (and retired the pin).
          const stored = current === null ? null : await store.read().catch(() => current)
          if (stored !== null) await beforeKeysDiscarded(discardedOf(stored.accountId === undefined && account !== undefined ? { ...stored, accountId: account } : stored, "logout"))
          await store.clear()
        }
      })
    },
    /** `expect` rejects a stored credential that is no longer the caller's captured identity before any refresh. */
    async accessToken(expect?: (current: Credentials) => boolean): Promise<string> {
      signal?.throwIfAborted()
      const snapshot = await store.read()
      signal?.throwIfAborted()
      // Only an unjournaled token beyond the refresh path's 30s skew can avoid the writer lock.
      // Account-bound callers compare their captured keys, account and generation through `expect`.
      if (snapshot !== null && snapshot.refreshState !== "uncertain" && snapshot.refreshAttempt === undefined
          && Date.parse(snapshot.accessTokenExpiresAt) > now() + 30_000
          && (expect === undefined || expect(snapshot))) return snapshot.accessToken
      return locked(async () => {
        const current = await store.readAuthoritative()
        if (current === null) throw new SignInError(`Not signed in. ${signInHint("first")}`)
        if (expect !== undefined && !expect(current)) throw new CredentialIdentityChanged()
        return (await refreshed(current)).accessToken
      })
    },
    async removeForLimit(error: unknown, choose: ChooseDevice): Promise<boolean> {
      if (!(error instanceof ApiRefusal) || error.detail === undefined) throw error
      const headers = { authorization: `Bearer ${error.detail.managementToken}` }
      const listed = parseReply(deviceListSchema, await request("/v1/devices", { headers }))
      const devices = listed.devices.filter(device => device.revokedAt === null)
      const chosen = await choose(devices)
      if (chosen === null) return false
      if (!devices.some(device => device.id === chosen)) throw new SignInError("No matching device was selected.")
      await request(`/v1/devices/${encodeURIComponent(chosen)}`, { method: "DELETE", headers })
      return true
    },
  }
}
export type Session = ReturnType<typeof createSession>

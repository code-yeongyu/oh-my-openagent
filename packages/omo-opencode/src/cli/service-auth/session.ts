import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { withLock } from "@oh-my-opencode/team-core/team-state-store/locks"
import { signInHint } from "./accounts-gate"
import { credentialId, type CredentialStore, CredentialStoreError, type LockedStore } from "./keystore"
import {
  ApiRefusal,
  type ChooseDevice,
  type Credentials,
  deviceListSchema,
  jsonRequest,
  parseReply,
  refusalGuidance,
  refusalMessage,
  requestApi,
  RequestFailure,
  serviceOrigin,
  SignInError,
  tokenSchema,
} from "./protocol"
import { clearSignedOutMarker, readSignedOutMarker, signedOutMarkerPath, writeSignedOutMarker } from "./signed-out-marker"

// `code` is the service's terminal refusal code, never its message.
export class SessionEnded extends SignInError {
  constructor(
    message: string,
    readonly deviceRevoked: boolean,
    readonly code: string,
  ) {
    super(message)
  }
}

// The service revokes the device row before answering reauth_required on refresh (token reuse);
// account_deleted removes the account and device_revoked confirms it is already revoked.
// unauthorized and invalid_grant leave the device's slot held.
const DEVICE_REVOKING_REFUSALS = new Set(["account_deleted", "reauth_required", "device_revoked"])

export function createSession(options: { readonly api: string; readonly store: CredentialStore; readonly home?: string; readonly signal?: AbortSignal }) {
  const api = serviceOrigin(options.api)
  const { store, signal } = options
  const directory = join(options.home ?? homedir(), ".omo", "session-locks")
  const lockPath = join(directory, `${credentialId(api)}.lock`)
  const markerPath = signedOutMarkerPath(options.home ?? homedir(), credentialId(api))
  type View = LockedStore<Credentials>
  const plainView: View = {
    read: () => store.read(),
    write: value => store.write(value),
    clear: () => store.clear(),
    recover: async () => {},
    settle: async () => {},
  }
  // Any approval dialog happens in prepare(), before the lock: no access dialog is ever open while it is held. Inside,
  // every section first converges an interrupted migration (#11262 design 3.2, 3.4).
  async function locked<T>(action: (view: View) => Promise<T>): Promise<T> {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    signal?.throwIfAborted()
    await store.prepare?.()
    return withLock(
      lockPath,
      async lease => {
        signal?.throwIfAborted()
        const view = (await store.underLock?.(lease)) ?? plainView
        await view.recover()
        return action(view)
      },
      { ownerTag: "cli-session", staleAfterMs: Number.POSITIVE_INFINITY },
    )
  }
  const request = (path: string, init: RequestInit) => requestApi(api, path, init, signal)
  const uncertain = () =>
    new SignInError(
      `The refresh outcome is unknown. Saved credentials and keys were retained, but this refresh token will not be sent again. ${signInHint("again")}`,
      true,
    )
  async function refreshedAccess(current: Credentials, view: View): Promise<string> {
    if (current.refreshState === "uncertain") throw uncertain()
    if (Date.parse(current.accessTokenExpiresAt) > Date.now() + 30_000) return current.accessToken
    // Journal before sending: a lost response or process crash must never replay a single-use token.
    await view.write({ ...current, refreshState: "uncertain" })
    try {
      const tokens = parseReply(tokenSchema, await request("/v1/session/refresh", jsonRequest({ refreshToken: current.refreshToken })))
      await view.write({ ...current, ...tokens })
      return tokens.accessToken
    } catch (error) {
      if (error instanceof CredentialStoreError) throw error
      if (error instanceof ApiRefusal && error.status < 500 && ["unauthorized", "account_deleted", "reauth_required", "invalid_grant", "device_revoked"].includes(error.code)) {
        await view.clear()
        throw new SessionEnded(
          error.code === "reauth_required"
            ? `This session was ended because its refresh token was reused. ${signInHint("again")}`
            : refusalMessage(refusalGuidance(error.code, error.status)),
          DEVICE_REVOKING_REFUSALS.has(error.code),
          error.code,
        )
      }
      if ((error instanceof RequestFailure && error.notSent) || (error instanceof ApiRefusal && error.status === 429 && error.code === "rate_limited")) {
        await view.write(current)
        throw error
      }
      throw uncertain()
    }
  }
  return {
    request,
    signal,
    async ready() {
      await store.read()
    },
    async save(value: Credentials) {
      await locked(async view => {
        await view.write(value, "fresh-sign-in")
        await clearSignedOutMarker(markerPath)
      })
    },
    /** The marker an explicit `omo logout` left, or null; only an empty store makes it meaningful. */
    signedOutMarker: () => readSignedOutMarker(markerPath),
    clearSignedOutMarker: () => clearSignedOutMarker(markerPath),
    async update<T>(action: (current: Credentials | null, view: View) => Promise<T>): Promise<T> {
      return locked(async view => action(await view.read(), view))
    },
    async logout(): Promise<boolean> {
      return locked(async view => {
        let current: Credentials | null = null
        try {
          current = await view.read()
          if (current !== null) {
            if (current.refreshState === "uncertain") return false
            const access = Date.parse(current.accessTokenExpiresAt) <= Date.now() ? await refreshedAccess(current, view) : current.accessToken
            await request(`/v1/devices/${encodeURIComponent(current.device.id)}`, {
              method: "DELETE",
              headers: { authorization: `Bearer ${access}` },
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
          await view.clear()
        }
      })
    },
    async accessToken(): Promise<string> {
      return locked(async view => {
        const current = await view.read()
        if (current === null) throw new SignInError(`Not signed in. ${signInHint("first")}`)
        await view.settle()
        return refreshedAccess(current, view)
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

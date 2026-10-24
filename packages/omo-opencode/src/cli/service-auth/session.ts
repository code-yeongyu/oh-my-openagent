import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { withLock } from "@oh-my-opencode/team-core/team-state-store/locks"
import { credentialId, type CredentialStore, CredentialStoreError } from "./keystore"
import {
  ApiRefusal, type ChooseDevice, type Credentials, deviceListSchema, jsonRequest, parseReply,
  requestApi, RequestFailure, serviceOrigin, SignInError, tokenSchema,
} from "./protocol"

export class SessionEnded extends SignInError {
  constructor(message: string, readonly deviceRevoked: boolean, readonly code: string) { super(message) }
}

const DEVICE_REVOKING_REFUSALS = new Set(["account_deleted", "reauth_required", "device_revoked"])

export function createSession(options: {
  readonly api: string
  readonly store: CredentialStore
  readonly home?: string
  readonly signal?: AbortSignal
  readonly now?: () => number
}) {
  const api = serviceOrigin(options.api)
  const now = options.now ?? Date.now
  const { store, signal } = options
  const directory = join(options.home ?? homedir(), ".omo", "session-locks")
  const lockPath = join(directory, `${credentialId(api)}.lock`)
  async function locked<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    signal?.throwIfAborted()
    return withLock(lockPath, async () => { signal?.throwIfAborted(); return action() },
      { ownerTag: "cli-session", staleAfterMs: Number.POSITIVE_INFINITY })
  }
  const request = (path: string, init: RequestInit) => requestApi(api, path, init, signal)
  async function refreshed(current: Credentials): Promise<Credentials> {
    // Legacy state cannot prove the original key, identity and age. Only protocol-2's owned
    // transaction can recover; neither a draft key nor a new key authorizes a legacy resend.
    if (current.refreshState === "uncertain" || current.refreshAttempt !== undefined) {
      throw new SessionEnded("Refresh recovery can no longer be proved safe. Sign in again with omo login.", false, "refresh_recovery_expired")
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
        await store.clear()
        throw new SessionEnded(error.code === "reauth_required"
          ? "This session was ended because its refresh token was reused. Sign in again with omo login."
          : "Sign in again with omo login.", DEVICE_REVOKING_REFUSALS.has(error.code), error.code)
      }
      if ((error instanceof RequestFailure && error.notSent) ||
          (error instanceof ApiRefusal && error.status === 429 && error.code === "rate_limited")) {
        await store.write(current)
        throw error
      }
      throw new SessionEnded("The refresh outcome is unknown. Saved credentials and keys were retained. Sign in again with omo login.", false, "refresh_recovery_expired")
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
    async save(value: Credentials) { await locked(() => store.write(value)) },
    async update<T>(action: (current: Credentials | null) => Promise<T>): Promise<T> {
      return locked(async () => action(await store.read()))
    },
    accessSnapshot: snapshot,
    async logout(): Promise<boolean> {
      return locked(async () => {
        try {
          const current = await store.read()
          if (current !== null) {
            if (current.refreshState === "uncertain") return false
            const access = Date.parse(current.accessTokenExpiresAt) <= now() ? (await refreshed(current)).accessToken : current.accessToken
            await request(`/v1/devices/${encodeURIComponent(current.device.id)}`, {
              method: "DELETE", headers: { authorization: `Bearer ${access}` },
            })
          }
          return true
        } catch (error) {
          if (error instanceof SessionEnded) return error.deviceRevoked
          if (error instanceof SignInError) return false
          throw error
        } finally { await store.clear() }
      })
    },
    async accessToken(): Promise<string> {
      const current = await snapshot()
      if (current === null) throw new SignInError("Not signed in. Run omo login.")
      return current.accessToken
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

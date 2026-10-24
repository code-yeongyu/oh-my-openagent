import { randomUUID } from "node:crypto"
import { createCredentialAuthority, credentialAuthoritySchema, type CredentialAuthority } from "./credential-authority"
import { type CredentialStore, createSealedStore, type SealedStore } from "./keystore"
import { OwnedSessionEnded, RecoveryExhausted, RecoveryPending, refreshOwnedCredential } from "./owned-refresh"
import { ownerHasPendingRevocation, revokePending } from "./pending-revocation"
import { ApiRefusal, type Credentials, serviceOrigin, SignInError } from "./protocol"
import { ownedCredentialSchema, type OwnedCredential, revocationsSchema, type Revocations, type RevokePendingRequest } from "./protocol-v2"
import type { RecoveryClock } from "./recovery-clock"
import { createSession } from "./session"
import { createWriterProtocol } from "./writer-protocol"

export function createProtocol2Session(options: {
  readonly api: string
  readonly legacy: CredentialStore
  readonly store?: SealedStore<CredentialAuthority>
  readonly revocations?: SealedStore<Revocations>
  readonly home?: string
  readonly signal?: AbortSignal
  readonly clock?: RecoveryClock
  readonly now?: () => number
  readonly notice?: (message: string) => void
}) {
  const api = serviceOrigin(options.api)
  const store = options.store ?? createSealedStore(api, "omo-cli-v2", credentialAuthoritySchema, undefined, undefined, undefined, options.notice)
  const pending = options.revocations ?? createSealedStore(api, "omo-cli-revocations-v2", revocationsSchema, undefined, undefined, undefined, options.notice)
  const legacySession = createSession({ api, store: options.legacy, ...(options.home === undefined ? {} : { home: options.home }),
    ...(options.signal === undefined ? {} : { signal: options.signal }) })
  const wire = createWriterProtocol(api, options.signal, options.now)
  const authority = createCredentialAuthority({
    origin: api, legacy: options.legacy, store, enrollment: wire.enrollment, adoption: wire.adoption,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  })
  const active: SealedStore<OwnedCredential> = {
    read: async () => (await store.read())?.active ?? null,
    write: async credential => { await store.write({ version: 2, active: credential }) },
    clear: async () => {
      const current = await store.read()
      if (current !== null) await store.write({ ...current, active: null })
    },
  }
  const refresh = (current: OwnedCredential, write: (value: OwnedCredential) => Promise<void>) =>
    refreshOwnedCredential({ origin: api, current, write, rotate: wire.rotate,
      ...(options.clock === undefined ? {} : { clock: options.clock }) })
  const revokeOwned = async (request: RevokePendingRequest) => revokePending(request, {
    active, pending,
    refresh: async (current, write) => {
      try { return { state: "ready", credential: await refresh(current, write) } } catch (error) {
        if (error instanceof RecoveryPending) return { state: "pending" }
        if (error instanceof RecoveryExhausted) return { state: "exhausted" }
        if (error instanceof OwnedSessionEnded) return { state: error.deviceRevoked ? "revoked" : "exhausted" }
        throw error
      }
    },
    revoke: async current => {
      try {
        await legacySession.request(`/v1/devices/${encodeURIComponent(current.owner.deviceId)}`, {
          method: "DELETE", headers: { authorization: `Bearer ${current.accessToken}` },
        })
        return "confirmed"
      } catch (error) {
        if (error instanceof ApiRefusal && error.status < 500 && ["device_revoked", "account_deleted"].includes(error.code)) return "confirmed"
        if (error instanceof SignInError) return "unconfirmed"
        throw error
      }
    },
  })
  const snapshot = () => legacySession.transaction(async () => {
    const current = await authority.ensure()
    if (current === null) return null
    if (ownerHasPendingRevocation(await pending.read(), current.owner)) throw new OwnedSessionEnded("signout_pending", false)
    try { return await refresh(current, active.write) } catch (error) {
      if (error instanceof OwnedSessionEnded && error.deviceRevoked) await active.clear()
      throw error
    }
  })
  return {
    signal: options.signal,
    request: (path: string, init: RequestInit) => {
      const headers = new Headers(init.headers)
      if (path === "/v1/device/token" || path === "/v1/session/exchange") headers.set("omo-refresh-writer-version", "2")
      return legacySession.request(path, { ...init, headers })
    },
    async ready() {
      await store.read()
      if (!await wire.adoption.available()) throw new OwnedSessionEnded("service_upgrade_required", false)
    },
    async save(incoming: Credentials) {
      if (!incoming.freshAuthorizationProof) throw new OwnedSessionEnded("service_upgrade_required", false)
      const credential = ownedCredentialSchema.safeParse(incoming)
      if (!credential.success) throw new RecoveryExhausted()
      await legacySession.transaction(() => authority.adopt(credential.data, incoming.freshAuthorizationProof ?? "", "fresh_sign_in"))
    },
    async adopt(incoming: Credentials, replace: boolean) {
      if (!incoming.freshAuthorizationProof) {
        // Legacy import can populate only the old namespace. It never replaces protocol-2
        // enrollment, adoption, active credentials or their journal.
        return legacySession.transaction(async () => {
          const held = await store.read()
          if (held !== null) {
            if (held.active !== null) return { conflict: held.active.device }
            throw new OwnedSessionEnded("service_upgrade_required", false)
          }
          const current = await options.legacy.read()
          if (current !== null && current.device.id !== incoming.device.id && !replace) return { conflict: current.device }
          const keep = current !== null && current.device.id === incoming.device.id &&
            (current.refreshState === "uncertain" || Date.parse(current.accessTokenExpiresAt) > Date.parse(incoming.accessTokenExpiresAt))
          if (!keep) await options.legacy.write(incoming)
          return { adopted: keep ? current.device : incoming.device }
        })
      }
      const credential = ownedCredentialSchema.safeParse(incoming)
      if (!credential.success) throw new RecoveryExhausted()
      return legacySession.transaction(async () => {
        const current = await active.read()
        if (current !== null && current.device.id !== incoming.device.id && !replace) return { conflict: current.device }
        const saved = await authority.adopt(credential.data, incoming.freshAuthorizationProof ?? "", replace ? "replace_account" : "fresh_sign_in")
        return { adopted: saved.device }
      })
    },
    accessSnapshot: snapshot,
    async accessToken() {
      const current = await snapshot()
      if (current === null) throw new SignInError("Not signed in. Run omo login.")
      return current.accessToken
    },
    stored: () => legacySession.transaction(async () => {
      const state = await store.read()
      if (state !== null) return state.active !== null && ownerHasPendingRevocation(await pending.read(), state.active.owner) ? null : state.active
      return options.legacy.read()
    }),
    forget: () => legacySession.transaction(async () => { await store.clear(); await options.legacy.clear() }),
    revokePending: (request: RevokePendingRequest) => legacySession.transaction(async () => {
      const existing = await pending.read()
      if (!existing?.records.some(record => record.revocationId === request.revocationId ||
          record.originalOwner.ownerHandle === request.owner.ownerHandle) && !await wire.pendingAvailable()) {
        throw new OwnedSessionEnded("service_upgrade_required", false)
      }
      return revokeOwned(request)
    }),
    logout: () => legacySession.transaction(async () => {
      const current = await authority.ensure()
      if (current === null) {
        const outstanding = (await pending.read())?.records.filter(record => record.state !== "settled") ?? []
        let confirmed = true
        for (const record of outstanding) {
          const result = await revokeOwned({ version: 2, revocationId: record.revocationId, owner: record.originalOwner })
          if (result.exit !== 0 || result.body.revocation.state !== "confirmed") confirmed = false
        }
        return confirmed
      }
      if (!await wire.pendingAvailable()) throw new OwnedSessionEnded("service_upgrade_required", false)
      const result = await revokeOwned({ version: 2, revocationId: randomUUID(), owner: current.owner })
      return result.exit === 0 && result.body.revocation.state === "confirmed"
    }),
    removeForLimit: legacySession.removeForLimit,
  }
}
export type Protocol2Session = ReturnType<typeof createProtocol2Session>

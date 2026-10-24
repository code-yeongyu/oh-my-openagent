import type { SealedStore } from "./keystore"
import { sameStableOwner, sameOwnerSnapshot as sameRequestedOwner } from "./credential-owner"
import {
  type CredentialOwner, type OwnedCredential, type RevocationRecord, type RevocationReply,
  type Revocations, type RevokePendingRequest,
} from "./protocol-v2"

type PendingReason = "refresh_recovery_pending" | "refresh_recovery_exhausted" | "remote_unconfirmed"
type RefreshResult =
  | { readonly state: "ready"; readonly credential: OwnedCredential }
  | { readonly state: "pending" | "exhausted" | "revoked" }

export type RevokePendingResult =
  | { readonly exit: 0; readonly body: RevocationReply }
  | { readonly exit: 1 | 2; readonly body: { readonly error: "owner_unavailable" | "revocation_id_conflict" } }
  | { readonly exit: 3; readonly body: { readonly ownerChanged: { readonly current: CredentialOwner } } }

export function ownerHasPendingRevocation(records: Revocations | null, owner: CredentialOwner): boolean {
  return records?.records.some(record => record.state !== "settled" && record.originalOwner.ownerHandle === owner.ownerHandle) ?? false
}

// The caller holds the same per-origin lock used by account token, enrollment and adoption.
export async function revokePending(
  request: RevokePendingRequest,
  dependencies: {
    readonly active: SealedStore<OwnedCredential>
    readonly pending: SealedStore<Revocations>
    readonly refresh: (credential: OwnedCredential, write: (next: OwnedCredential) => Promise<void>) => Promise<RefreshResult>
    readonly revoke: (credential: OwnedCredential) => Promise<"confirmed" | "unconfirmed">
  },
): Promise<RevokePendingResult> {
  const { active, pending } = dependencies
  let records = (await pending.read())?.records ?? []
  let owned = records.find(record => record.revocationId === request.revocationId)
  const save = async (record: RevocationRecord): Promise<void> => {
    const next = records.filter(row => row.revocationId !== record.revocationId).concat(record)
    await pending.write({ version: 2, records: next })
    records = next
    owned = record
  }
  const clearMatching = async (owner: CredentialOwner): Promise<void> => {
    const current = await active.read()
    if (current?.owner.ownerHandle === owner.ownerHandle) await active.clear()
  }
  const settle = async (record: Exclude<RevocationRecord, { state: "settled" }>): Promise<RevokePendingResult> => {
    const response: RevocationReply = {
      revocation: { revocationId: record.revocationId, state: "confirmed", owner: record.credential.owner },
    }
    await save({ ...record, state: "confirmed_uncommitted" })
    await clearMatching(record.originalOwner)
    // No credential or key material survives settlement. The exact response survives a lost answer.
    await save({
      revocationId: record.revocationId, originalOwner: record.originalOwner, state: "settled",
      response: { revocation: { revocationId: record.revocationId, state: "confirmed", owner: record.credential.owner } },
    })
    return { exit: 0, body: response }
  }
  if (owned !== undefined) {
    if (!sameStableOwner(owned.originalOwner, request.owner)) return { exit: 2, body: { error: "revocation_id_conflict" } }
    if (owned.state === "settled") return { exit: 0, body: owned.response }
    if (owned.state === "confirmed_uncommitted") return settle(owned)
  } else {
    const existing = records.find(record => record.state !== "settled" && record.originalOwner.ownerHandle === request.owner.ownerHandle)
    if (existing !== undefined && existing.state !== "settled") {
      return { exit: 0, body: { revocation: {
        revocationId: existing.revocationId, state: "pending", reason: "already_owned", owner: existing.credential.owner,
      } } }
    }
    const current = await active.read()
    if (current === null) return { exit: 1, body: { error: "owner_unavailable" } }
    if (!sameStableOwner(current.owner, request.owner)) return { exit: 3, body: { ownerChanged: { current: current.owner } } }
    if (current.owner.generation < request.owner.generation) return { exit: 1, body: { error: "owner_unavailable" } }
    owned = {
      revocationId: request.revocationId, originalOwner: { ...request.owner },
      state: "pending", recoveryExhausted: false, credential: current,
    }
    await save(owned)
  }
  // Existing operations get here without validating against or using B's active credential.
  const record = owned
  if (record.state !== "pending") throw new Error("Unexpected revocation state")
  await clearMatching(record.originalOwner)
  let cursor = record.credential
  const replyPending = (reason: PendingReason): RevokePendingResult => ({ exit: 0, body: { revocation: {
    revocationId: record.revocationId, state: "pending", reason, owner: cursor.owner,
  } } })
  if (record.recoveryExhausted) return replyPending("refresh_recovery_exhausted")
  const refreshed = await dependencies.refresh(cursor, async next => {
    if (!sameStableOwner(next.owner, record.originalOwner) || next.owner.generation < cursor.owner.generation) {
      throw new Error("Revocation credential ownership changed")
    }
    await save({ ...record, credential: next })
    cursor = next
  })
  switch (refreshed.state) {
    case "pending":
      return replyPending("refresh_recovery_pending")
    case "exhausted":
      await save({ ...record, credential: cursor, recoveryExhausted: true })
      return replyPending("refresh_recovery_exhausted")
    case "revoked":
      return settle({ ...record, credential: cursor })
    case "ready": {
      // The refresh port commits its successor through the owned writer before returning it.
      if (!sameRequestedOwner(refreshed.credential.owner, cursor.owner) || refreshed.credential.refreshToken !== cursor.refreshToken) {
        throw new Error("Uncommitted revocation credential")
      }
      return await dependencies.revoke(cursor) === "confirmed"
        ? settle({ ...record, credential: cursor })
        : replyPending("remote_unconfirmed")
    }
  }
}

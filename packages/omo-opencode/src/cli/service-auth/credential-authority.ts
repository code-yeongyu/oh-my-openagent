import { randomBytes, randomUUID } from "node:crypto"
import { z } from "zod"
import type { CredentialStore, SealedStore } from "./keystore"
import { OwnedSessionEnded, RecoveryExhausted, RecoveryPending } from "./owned-refresh"
import { ApiRefusal, credentialSchema, type Credentials } from "./protocol"
import { credentialOwnerSchema, ownedCredentialSchema, type CredentialOwner, type OwnedCredential } from "./protocol-v2"
import { eligibleAttempt, newRefreshAttempt, refreshAttemptSchema, refreshTokenHash, sameOwner } from "./refresh-attempt"
import { readRecoveryClock, type RecoveryClock } from "./recovery-clock"

const enrollmentSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("staged"), enrollmentId: z.string().min(1), authorization: z.string().min(1),
    original: credentialSchema, owner: credentialOwnerSchema, attempt: refreshAttemptSchema,
  }),
  z.object({ state: z.literal("claimed"), credential: ownedCredentialSchema }),
])
const adoptionSchema = z.object({
  state: z.enum(["staged", "approved"]), adoptionId: z.string().min(1),
  action: z.enum(["fresh_sign_in", "replace_account"]), proof: z.string().min(1), proofHash: z.string().regex(/^[a-f0-9]{64}$/),
  incoming: ownedCredentialSchema, expectedActiveOwner: credentialOwnerSchema.nullable(),
})
export const credentialAuthoritySchema = z.object({
  version: z.literal(2),
  active: ownedCredentialSchema.nullable(),
  enrollment: enrollmentSchema.optional(),
  adoption: adoptionSchema.optional(),
})
export type CredentialAuthority = z.infer<typeof credentialAuthoritySchema>
export type Adoption = z.infer<typeof adoptionSchema>
export type StagedEnrollment = Extract<z.infer<typeof enrollmentSchema>, { state: "staged" }>
export interface AdoptionPort {
  readonly available: () => Promise<boolean>
  readonly approve: (transaction: Adoption) => Promise<"approved" | "already_approved" | "proof_invalid" | "proof_expired" | "proof_used" | "adoption_mismatch" | "credential_mismatch" | "active_owner_changed">
}

export interface EnrollmentPort {
  readonly available: () => Promise<boolean>
  readonly bootstrap: (source: Credentials, enrollmentId: string, key: string) => Promise<
    | { readonly result: "ready" | "legacy_uncertain_current"; readonly owner: CredentialOwner; readonly authorization: string }
    | { readonly result: "legacy_uncertain_spent" | "expired" | "revoked" | "account_deleted" | "source_stale" | "service_upgrade_required" }
  >
  readonly claim: (staged: StagedEnrollment) => Promise<
    | { readonly result: "claimed" | "already_claimed"; readonly credential: OwnedCredential }
    | { readonly result: "source_stale" | "enrollment_mismatch" | "enrollment_recovery_expired" | "enrollment_successor_advanced" | "service_upgrade_required" }
  >
}

const capabilityFailure = () => new OwnedSessionEnded("service_upgrade_required", false)
const sameSnapshot = (left: CredentialOwner | null, right: CredentialOwner | null): boolean =>
  left === null || right === null ? left === right : sameOwner(left, right) && left.generation === right.generation

// All methods run within the caller's per-origin lock. Wire adapters normalize server replies;
// this state machine never infers identity from an opaque refresh token or access-token iat.
export function createCredentialAuthority(options: {
  readonly origin: string
  readonly legacy: CredentialStore
  readonly store: SealedStore<CredentialAuthority>
  readonly enrollment: EnrollmentPort
  readonly adoption: AdoptionPort
  readonly clock?: RecoveryClock
}) {
  const { store, legacy, enrollment, origin } = options
  const clock = options.clock ?? readRecoveryClock
  async function activate(credential: OwnedCredential): Promise<OwnedCredential> {
    await store.write({ version: 2, active: credential })
    // Failure here cannot undo the committed protocol-2 authority.
    await legacy.clear()
    return credential
  }
  async function ensure(): Promise<OwnedCredential | null> {
    let state = await store.read()
    if (state?.adoption !== undefined) return adopt(state.adoption.incoming, state.adoption.proof, state.adoption.action)
    if (state?.active !== null && state?.active !== undefined) return state.active
    if (state?.enrollment?.state === "claimed") return activate(state.enrollment.credential)
    if (state?.enrollment === undefined) {
      const source = await legacy.read()
      if (source === null) return null
      if (!await enrollment.available()) throw capabilityFailure()
      const enrollmentId = randomUUID()
      const key = randomBytes(32).toString("base64url")
      const resolved = await enrollment.bootstrap(source, enrollmentId, key)
      if (resolved.result !== "ready" && resolved.result !== "legacy_uncertain_current") {
        if (resolved.result === "service_upgrade_required") throw capabilityFailure()
        if (resolved.result === "revoked" || resolved.result === "account_deleted") {
          throw new OwnedSessionEnded(resolved.result === "revoked" ? "device_revoked" : "account_deleted", true)
        }
        throw new RecoveryExhausted()
      }
      if (resolved.owner.deviceId !== source.device.id) throw new RecoveryExhausted()
      const reading = await clock()
      if (reading === null) throw new RecoveryExhausted()
      const attempt = newRefreshAttempt(origin, resolved.owner, source.refreshToken, reading, key)
      state = { version: 2, active: null, enrollment: {
        state: "staged", enrollmentId, authorization: resolved.authorization, original: source, owner: resolved.owner, attempt,
      } }
      await store.write(state)
    }
    const staged = state.enrollment
    if (staged === undefined || staged.state !== "staged") throw new RecoveryExhausted()
    if (eligibleAttempt(staged.attempt, origin, staged.owner, staged.original.refreshToken, await clock()) === null) throw new RecoveryExhausted()
    let result: Awaited<ReturnType<EnrollmentPort["claim"]>>
    try { result = await enrollment.claim(staged) } catch (error) {
      if (error instanceof ApiRefusal && error.status < 500 && error.status !== 429 &&
          ["service_upgrade_required", "unauthorized", "invalid_grant", "device_revoked", "account_deleted"].includes(error.code)) {
        throw new OwnedSessionEnded(error.code, error.code === "device_revoked" || error.code === "account_deleted")
      }
      if (eligibleAttempt(staged.attempt, origin, staged.owner, staged.original.refreshToken, await clock()) === null) throw new RecoveryExhausted()
      throw new RecoveryPending(staged.attempt.deadline)
    }
    if (result.result === "service_upgrade_required") throw capabilityFailure()
    if (result.result === "source_stale") {
      await store.clear()
      const current = await legacy.read()
      if (current === null || current.device.id !== staged.original.device.id ||
          refreshTokenHash(current.refreshToken) === staged.attempt.refreshTokenHash) throw new RecoveryExhausted()
      return ensure()
    }
    if (result.result !== "claimed" && result.result !== "already_claimed") throw new RecoveryExhausted()
    const claimed = result.credential
    if (claimed.writerFloor !== 2 || !sameOwner(staged.owner, claimed.owner) ||
        claimed.owner.generation !== staged.owner.generation + 1 || claimed.device.id !== staged.owner.deviceId ||
        claimed.refreshToken === staged.original.refreshToken || claimed.refreshAttempt !== undefined) throw new RecoveryExhausted()
    await store.write({ version: 2, active: null, enrollment: { state: "claimed", credential: claimed } })
    return activate(claimed)
  }
  async function adopt(
    incoming: OwnedCredential,
    proof: string,
    action: Adoption["action"],
  ): Promise<OwnedCredential> {
    const port = options.adoption
    const state = await store.read() ?? { version: 2 as const, active: null }
    let transaction = state.adoption
    if (transaction === undefined) {
      if (!await port.available()) throw capabilityFailure()
      if (incoming.writerFloor !== 2 || incoming.refreshState !== undefined || incoming.refreshAttempt !== undefined) throw new RecoveryExhausted()
      transaction = {
        state: "staged", adoptionId: randomUUID(), action, proof, proofHash: refreshTokenHash(proof),
        incoming, expectedActiveOwner: state.active?.owner ?? null,
      }
      await store.write({ ...state, adoption: transaction })
    } else if (transaction.proofHash !== refreshTokenHash(proof) ||
        transaction.incoming.refreshToken !== incoming.refreshToken || transaction.action !== action ||
        !sameSnapshot(transaction.incoming.owner, incoming.owner)) {
      throw new OwnedSessionEnded("adoption_mismatch", false)
    }
    if (transaction.state === "staged") {
      const result = await port.approve(transaction)
      if (result !== "approved" && result !== "already_approved") throw new OwnedSessionEnded(result, false)
      const afterApproval = await store.read()
      if (!sameSnapshot(afterApproval?.active?.owner ?? null, transaction.expectedActiveOwner) ||
          afterApproval?.adoption?.adoptionId !== transaction.adoptionId) throw new OwnedSessionEnded("active_owner_changed", false)
      transaction = { ...transaction, state: "approved" }
      await store.write({ ...afterApproval, adoption: transaction })
    }
    const current = await store.read()
    if (!sameSnapshot(current?.active?.owner ?? null, transaction.expectedActiveOwner) ||
        current?.adoption?.adoptionId !== transaction.adoptionId) throw new OwnedSessionEnded("active_owner_changed", false)
    return activate(transaction.incoming)
  }
  return { ensure, adopt }
}

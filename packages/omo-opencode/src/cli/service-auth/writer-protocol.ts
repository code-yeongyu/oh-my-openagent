import { createPrivateKey, sign } from "node:crypto"
import { z } from "zod"
import type { Adoption, AdoptionPort, EnrollmentPort } from "./credential-authority"
import { credentialOwnerSchema, sameOwnerSnapshot } from "./credential-owner"
import { RecoveryExhausted } from "./owned-refresh"
import { ApiRefusal, InvalidApiResponse, jsonRequest, parseReply, requestApi, RequestFailure, serviceOrigin, SignInError } from "./protocol"
import { type OwnedCredential } from "./protocol-v2"
import { refreshTokenHash, type RefreshAttempt } from "./refresh-attempt"

const opaque = z.string().regex(/^[\x21-\x7e]{1,4096}$/)
const nonce = z.string().refine(value => /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, "base64url").toString("base64url") === value)
const canonicalTime = z.string().refine(value => Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value)
const challengeSchema = z.object({
  version: z.literal(1), purpose: z.literal("refresh_writer_enrollment"), serviceOrigin: z.string(),
  challengeNonce: nonce, challengeExpiresAt: canonicalTime,
})
export const enrollmentIntentSchema = challengeSchema.extend({
  deviceId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), refreshTokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  enrollmentId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), idempotencyKey: nonce, requestedFloor: z.literal(2),
})
const writerCredentialSchema = z.object({
  owner: credentialOwnerSchema, writerFloor: z.literal(2), refreshToken: opaque,
  accessToken: opaque, accessTokenExpiresAt: z.string().datetime({ offset: true }),
})
const capabilitiesSchema = z.object({
  refreshWriterProtocols: z.array(z.number().int().positive()).optional(),
  refreshWriterBootstrap: z.literal("device-signature-v1").optional(),
  refreshWriterEnrollment: z.literal("generation-bound-v1").optional(),
  credentialAdoption: z.literal("fresh-authorization-v1").optional(),
  pendingRevocation: z.literal("generation-bound-v1").optional(),
})
const bootstrapSchema = z.discriminatedUnion("outcome", [
  z.object({
    version: z.literal(1), outcome: z.enum(["ready", "legacy_uncertain_current"]), owner: credentialOwnerSchema,
    writerFloor: z.union([z.literal(1), z.literal(2)]), enrollmentAuthorization: opaque, enrollmentAuthorizationExpiresAt: canonicalTime,
  }),
  z.object({ version: z.literal(1), outcome: z.enum([
    "legacy_uncertain_spent", "expired", "revoked", "account_deleted", "source_stale", "service_upgrade_required",
  ]) }),
])
const claimSchema = z.discriminatedUnion("outcome", [
  z.object({ version: z.literal(1), outcome: z.enum(["claimed", "already_claimed"]), credential: writerCredentialSchema }),
  z.object({ version: z.literal(1), outcome: z.enum([
    "source_stale", "enrollment_mismatch", "enrollment_recovery_expired", "enrollment_successor_advanced", "service_upgrade_required",
  ]) }),
])
const approvalSchema = z.discriminatedUnion("outcome", [
  z.object({
    version: z.literal(1), outcome: z.enum(["approved", "already_approved"]), adoptionId: z.string().min(1),
    action: z.enum(["fresh_sign_in", "replace_account"]), owner: credentialOwnerSchema,
    writerFloor: z.literal(2), expectedActiveOwner: credentialOwnerSchema.nullable(),
  }),
  z.object({ version: z.literal(1), outcome: z.enum([
    "proof_invalid", "proof_expired", "proof_used", "adoption_mismatch", "credential_mismatch", "active_owner_changed",
  ]) }),
])

// Kept byte-for-byte compatible with omo-service's writerEnrollmentSigningBytes; the public
// RFC 8032 fixture is the cross-repository conformance witness, not a JSON-stringify signature.
export function enrollmentSigningBytes(value: z.infer<typeof enrollmentIntentSchema>): Buffer {
  const intent = parseReply(enrollmentIntentSchema, value)
  if (serviceOrigin(intent.serviceOrigin) !== intent.serviceOrigin) throw new SignInError("Invalid enrollment origin.")
  const parts = [Buffer.from("omo-refresh-writer-enrollment/v1\0")]
  for (const field of [
    intent.serviceOrigin, intent.deviceId, intent.refreshTokenHash, intent.challengeNonce,
    intent.challengeExpiresAt, intent.enrollmentId, intent.idempotencyKey, String(intent.requestedFloor),
  ]) {
    const bytes = Buffer.from(field, "utf8")
    const length = Buffer.alloc(4)
    length.writeUInt32BE(bytes.length)
    parts.push(length, bytes)
  }
  return Buffer.concat(parts)
}

export function createWriterProtocol(api: string, signal?: AbortSignal, now = Date.now) {
  const origin = serviceOrigin(api)
  const request = (path: string, init: RequestInit) => requestApi(origin, path, init, signal)
  const post = (path: string, body: unknown) => request(path, {
    ...jsonRequest(body), headers: { "content-type": "application/json", "omo-refresh-writer-version": "2" },
  })
  const capabilities = async () => {
    let document: unknown
    try { document = await request("/.well-known/omo-service", { method: "GET" }) } catch (error) {
      if (error instanceof ApiRefusal && (error.status < 500 && error.status !== 429 || error.status === 501)) return null
      if (error instanceof RequestFailure && error.responseStatus !== undefined && error.responseStatus < 500) return null
      if (error instanceof InvalidApiResponse && error.status < 500) return null
      throw error
    }
    const parsed = z.object({ capabilities: capabilitiesSchema }).safeParse(document)
    return parsed.success ? parsed.data.capabilities : null
  }
  const enrollment: EnrollmentPort = {
    available: async () => {
      const supported = await capabilities()
      return supported?.refreshWriterProtocols?.includes(2) === true &&
        supported.refreshWriterBootstrap === "device-signature-v1" && supported.refreshWriterEnrollment === "generation-bound-v1"
    },
    bootstrap: async (source, enrollmentId, key) => {
      const answer = await post("/v1/session/writer-enrollment-challenges", { version: 1, purpose: "refresh_writer_enrollment" })
      if (z.object({ version: z.literal(1), outcome: z.literal("service_upgrade_required") }).safeParse(answer).success) {
        return { result: "service_upgrade_required" }
      }
      const challenge = parseReply(challengeSchema, answer)
      if (challenge.serviceOrigin !== origin || Date.parse(challenge.challengeExpiresAt) <= now()) throw new RecoveryExhausted()
      const intent = {
        ...challenge, deviceId: source.device.id, refreshTokenHash: refreshTokenHash(source.refreshToken),
        enrollmentId, idempotencyKey: key, requestedFloor: 2 as const,
      }
      let signature: string
      try {
        signature = sign(null, enrollmentSigningBytes(intent), createPrivateKey({
          key: Buffer.from(source.signingPrivateKey, "base64"), format: "der", type: "pkcs8",
        })).toString("base64url")
      } catch {
        throw new SignInError("The stored device signing key cannot authorize enrollment.")
      }
      const result = parseReply(bootstrapSchema, await post("/v1/session/writer-enrollment-bootstrap", {
        version: 1, refreshToken: source.refreshToken, legacyState: source.refreshState === "uncertain" ? "uncertain" : "current", intent, signature,
      }))
      if (result.outcome !== "ready" && result.outcome !== "legacy_uncertain_current") return { result: result.outcome }
      if (result.owner.deviceId !== source.device.id || Date.parse(result.enrollmentAuthorizationExpiresAt) <= now()) throw new RecoveryExhausted()
      return { result: result.outcome, owner: result.owner, authorization: result.enrollmentAuthorization }
    },
    claim: async staged => {
      const result = parseReply(claimSchema, await post("/v1/session/writer-enrollments", {
        version: 1, enrollmentId: staged.enrollmentId, idempotencyKey: staged.attempt.idempotencyKey,
        expectedFamilyId: staged.owner.familyId, expectedGeneration: staged.owner.generation,
        refreshToken: staged.original.refreshToken, enrollmentAuthorization: staged.authorization,
      }))
      if (result.outcome !== "claimed" && result.outcome !== "already_claimed") return { result: result.outcome }
      const { refreshAttempt: _attempt, refreshState: _state, freshAuthorizationProof: _proof, ...original } = staged.original
      return { result: result.outcome, credential: { ...original, ...result.credential } }
    },
  }
  const adoption: AdoptionPort = {
    available: async () => (await capabilities())?.credentialAdoption === "fresh-authorization-v1",
    approve: async (transaction: Adoption) => {
      const result = parseReply(approvalSchema, await post("/v1/session/credential-adoptions", {
        version: 1, adoptionId: transaction.adoptionId, action: transaction.action,
        freshAuthorizationProof: transaction.proof,
        credential: {
          owner: transaction.incoming.owner, writerFloor: 2, refreshToken: transaction.incoming.refreshToken,
        },
        expectedActiveOwner: transaction.expectedActiveOwner,
      }))
      if (result.outcome === "approved" || result.outcome === "already_approved") {
        if (result.adoptionId !== transaction.adoptionId || result.action !== transaction.action ||
            !sameOwnerSnapshot(result.owner, transaction.incoming.owner) ||
            !sameOwnerSnapshot(result.expectedActiveOwner, transaction.expectedActiveOwner)) return "adoption_mismatch"
      }
      return result.outcome
    },
  }
  return {
    enrollment, adoption,
    pendingAvailable: async () => (await capabilities())?.pendingRevocation === "generation-bound-v1",
    async rotate(current: OwnedCredential, attempt: RefreshAttempt): Promise<OwnedCredential> {
      const result = parseReply(writerCredentialSchema, await request("/v1/session/refresh", {
        ...jsonRequest({ refreshToken: current.refreshToken }),
        headers: { "content-type": "application/json", "omo-refresh-writer-version": "2", "idempotency-key": attempt.idempotencyKey },
      }))
      const { refreshAttempt: _attempt, refreshState: _state, ...source } = current
      return { ...source, ...result }
    },
  }
}

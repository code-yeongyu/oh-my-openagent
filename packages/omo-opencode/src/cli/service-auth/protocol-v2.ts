import { z } from "zod"
import { credentialSchema } from "./protocol"
import { credentialOwnerSchema, sameStableOwner } from "./credential-owner"
export { credentialOwnerSchema, type CredentialOwner } from "./credential-owner"

export const ownedCredentialSchema = credentialSchema.omit({ freshAuthorizationProof: true }).extend({
  owner: credentialOwnerSchema,
  writerFloor: z.literal(2),
  // Keep an invalid journal intact so the recovery boundary rejects it without a new send.
  refreshAttempt: z.unknown().optional(),
}).refine(credential => credential.device.id === credential.owner.deviceId, "Credential device differs from its owner")
export type OwnedCredential = z.infer<typeof ownedCredentialSchema>

export const revocationReplySchema = z.object({
  revocation: z.discriminatedUnion("state", [
    z.object({
      revocationId: z.string().min(1), state: z.literal("confirmed"), owner: credentialOwnerSchema,
    }).strict(),
    z.object({
      revocationId: z.string().min(1), state: z.literal("pending"), owner: credentialOwnerSchema,
      reason: z.enum(["refresh_recovery_pending", "refresh_recovery_exhausted", "remote_unconfirmed", "already_owned"]),
    }).strict(),
  ]),
})
export type RevocationReply = z.infer<typeof revocationReplySchema>

const custody = {
  revocationId: z.string().min(1),
  originalOwner: credentialOwnerSchema,
  credential: ownedCredentialSchema,
}
export const revocationRecordSchema = z.discriminatedUnion("state", [
  z.object({ ...custody, state: z.literal("pending"), recoveryExhausted: z.boolean() }),
  z.object({ ...custody, state: z.literal("confirmed_uncommitted") }),
  z.object({
    revocationId: z.string().min(1), originalOwner: credentialOwnerSchema, state: z.literal("settled"),
    response: z.object({ revocation: z.object({
      revocationId: z.string().min(1), state: z.literal("confirmed"), owner: credentialOwnerSchema,
    }).strict() }).strict(),
  }).strict(),
]).refine(record => {
  const owner = record.state === "settled" ? record.response.revocation.owner : record.credential.owner
  return sameStableOwner(record.originalOwner, owner) && owner.generation >= record.originalOwner.generation &&
    (record.state !== "settled" || record.response.revocation.revocationId === record.revocationId)
}, "Revocation custody differs from its recorded target")
export type RevocationRecord = z.infer<typeof revocationRecordSchema>
export const revocationsSchema = z.object({ version: z.literal(2), records: z.array(revocationRecordSchema) }).refine(value => {
  const ids = new Set<string>()
  const owners = new Set<string>()
  return value.records.every(record => {
    if (ids.has(record.revocationId)) return false
    ids.add(record.revocationId)
    if (record.state === "settled") return true
    if (owners.has(record.originalOwner.ownerHandle)) return false
    owners.add(record.originalOwner.ownerHandle)
    return true
  })
}, "Duplicate revocation custody")
export type Revocations = z.infer<typeof revocationsSchema>

export const revokePendingRequestSchema = z.object({
  version: z.literal(2),
  revocationId: z.string().min(1).max(128),
  owner: credentialOwnerSchema,
}).strict()
export type RevokePendingRequest = z.infer<typeof revokePendingRequestSchema>

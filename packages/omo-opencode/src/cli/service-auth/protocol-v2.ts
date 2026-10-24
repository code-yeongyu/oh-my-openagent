import { z } from "zod"
import { credentialSchema } from "./protocol"
import { credentialOwnerSchema } from "./credential-owner"
export { credentialOwnerSchema, type CredentialOwner } from "./credential-owner"

export const ownedCredentialSchema = credentialSchema.omit({ freshAuthorizationProof: true }).extend({
  owner: credentialOwnerSchema,
  writerFloor: z.literal(2),
  // Keep an invalid journal intact so the recovery boundary rejects it without a new send.
  refreshAttempt: z.unknown().optional(),
})
export type OwnedCredential = z.infer<typeof ownedCredentialSchema>

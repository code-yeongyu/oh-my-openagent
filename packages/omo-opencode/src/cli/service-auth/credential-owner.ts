import { z } from "zod"

const identity = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
export const credentialOwnerSchema = z.object({
  accountId: identity, deviceId: identity, familyId: identity,
  generation: z.number().int().positive().safe(),
  ownerHandle: z.string().regex(/^[\x21-\x7e]{1,4096}$/),
})
export type CredentialOwner = z.infer<typeof credentialOwnerSchema>

export const sameStableOwner = (left: CredentialOwner, right: CredentialOwner): boolean =>
  left.accountId === right.accountId && left.deviceId === right.deviceId &&
  left.familyId === right.familyId && left.ownerHandle === right.ownerHandle
export const sameOwnerSnapshot = (left: CredentialOwner | null, right: CredentialOwner | null): boolean =>
  left === null || right === null ? left === right : sameStableOwner(left, right) && left.generation === right.generation

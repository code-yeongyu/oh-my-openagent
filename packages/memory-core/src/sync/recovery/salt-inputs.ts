import { RESERVED_RP_PREFIX } from "../crypto/recovery-kind.ts"
import type { RecoverySaltInput, RecoveryTransport } from "./ports.ts"

/**
 * The most recovery keys one account may hold at once. Enrollment refuses a key past it, and
 * recovery refuses a served list naming more enrolled credentials, so a hostile server cannot turn one
 * assertion into an unbounded salt list (#10412 review H3).
 */
export const MAX_RECOVERY_KEYS = 16

export type ServedSalts =
  | { readonly ok: true; readonly salts: ReadonlyArray<RecoverySaltInput> }
  | {
      readonly ok: false
      readonly reason: "unavailable" | "too-many-recovery-keys"
    }

type ServedKey = { readonly salt: RecoverySaltInput; readonly prf: boolean }

/** A phrase key, or anything in the reserved `omo-sync/` rp namespace, is never a PRF salt input (contract F12). */
const prfCapable = (value: unknown): boolean => {
  const rpId: unknown = Reflect.get(Object(value), "rp_id")
  return (
    Reflect.get(Object(value), "survivable") !== "phrase" &&
    !(typeof rpId === "string" && rpId.startsWith(RESERVED_RP_PREFIX))
  )
}

const saltOf = (value: unknown): ServedKey | null => {
  const credentialId: unknown = Reflect.get(Object(value), "credential_id")
  const enrollmentNonce: unknown = Reflect.get(Object(value), "enrollment_nonce")
  return typeof credentialId === "string" && typeof enrollmentNonce === "string"
    ? { salt: { credentialId, enrollmentNonce }, prf: prfCapable(value) }
    : null
}

const saltFromRow = (row: unknown): ServedKey | null => {
  const body: unknown = Reflect.get(Object(row), "body")
  const kind: unknown = Reflect.get(Object(body), "kind")
  if (kind === "genesis") return saltOf(Reflect.get(Object(Reflect.get(Object(body), "bootstrap")), "recovery_key"))
  return kind === "recovery-key" ? saltOf(body) : null
}

const removedCredential = (row: unknown): string | null => {
  const body: unknown = Reflect.get(Object(row), "body")
  const credentialId: unknown = Reflect.get(Object(body), "credential_id")
  return Reflect.get(Object(body), "kind") === "recovery-key-removed" && typeof credentialId === "string"
    ? credentialId
    : null
}

/**
 * The PRF salt inputs a recovery assertion needs, read from the served keyring rows BEFORE any
 * verification (review r3 option A): only credential ids and enrollment nonces, which are not
 * secrets. A wrong one yields keys that fail the anchored walk; nothing else from this parse is used.
 * A response that is not a list is unavailable, and more than MAX_RECOVERY_KEYS credentials
 * still enrolled (removal rows excluded) is refused before anything reaches the authenticator.
 */
export const servedSaltInputs = async (transport: RecoveryTransport): Promise<ServedSalts> => {
  const keys: unknown = await transport.listKeys()
  if (!Array.isArray(keys)) return { ok: false, reason: "unavailable" }
  const found = new Map<string, ServedKey>()
  const removed = new Set<string>()
  for (const row of keys) {
    const removal = removedCredential(row)
    if (removal !== null) removed.add(removal)
    const served = saltFromRow(row)
    if (served !== null && !found.has(served.salt.credentialId)) found.set(served.salt.credentialId, served)
  }
  for (const credentialId of removed) found.delete(credentialId)
  if (found.size > MAX_RECOVERY_KEYS) return { ok: false, reason: "too-many-recovery-keys" }
  return { ok: true, salts: [...found.values()].filter((served) => served.prf).map((served) => served.salt) }
}

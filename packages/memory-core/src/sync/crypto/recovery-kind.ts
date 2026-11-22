import { PHRASE_RECOVERY_RP_ID } from "./vendor/sync-format/chain.ts"
import { b64urlDecode } from "./vendor/sync-format/jcs.ts"

export { PHRASE_RECOVERY_RP_ID }

type KeyFields = {
  readonly credential_id: string
  readonly enrollment_nonce: string
  readonly sealing_public_key: string
  readonly signing_public_key: string
}
export type PasskeyRecoveryKey = KeyFields & { readonly rp_id: string; readonly survivable: "synced" | "roaming" }
export type PhraseRecoveryKey = KeyFields & {
  readonly rp_id: typeof PHRASE_RECOVERY_RP_ID
  readonly survivable: "phrase"
}
/** Discriminated on `survivable`: the kind IS the survivable value, so no record gains a field. */
export type RecoveryKey = PasskeyRecoveryKey | PhraseRecoveryKey

export const isPhraseKey = (key: RecoveryKey): key is PhraseRecoveryKey => key.survivable === "phrase"

/** The rp_id namespace reserved for OmO-defined recovery kinds; no passkey and no PRF salt may use it. */
export const RESERVED_RP_PREFIX = "omo-sync/"
const PHRASE_CREDENTIAL_BYTES = 16

const decodesTo = (text: string, length: number): boolean => {
  try {
    return b64urlDecode(text).length === length
  } catch {
    return false
  }
}

/**
 * The recovery-key kind rules of contract sec 1, shared by every boundary that admits a key: the
 * survivable value is one of three; it is "phrase" exactly when the rp_id is the phrase marker; a
 * phrase credential id is 16 bytes; a passkey rp_id never lies in the reserved `omo-sync/` namespace.
 */
export const recoveryKindOf = (
  survivable: unknown,
  rpId: string,
  credentialId: string,
): RecoveryKey["survivable"] | null => {
  if (survivable === "phrase") {
    return rpId === PHRASE_RECOVERY_RP_ID && decodesTo(credentialId, PHRASE_CREDENTIAL_BYTES) ? "phrase" : null
  }
  if (survivable !== "synced" && survivable !== "roaming") return null
  return rpId.startsWith(RESERVED_RP_PREFIX) ? null : survivable
}

import type { VerifiedWrap } from "../crypto/entry.ts"
import { wrapSetDigest } from "../crypto/links.ts"
import { PHRASE_RECOVERY_RP_ID, type PhraseRecoveryKey } from "../crypto/parse.ts"
import { openWrap } from "../crypto/unwrap.ts"
import { b64urlEncode } from "../crypto/vendor/sync-format/jcs.ts"
import { signFramed } from "../crypto/vendor/sync-format/keys.ts"
import { type PhraseBridgeRandom, type PhraseSurface, showAndConfirm } from "../genesis/phrase-bridge.ts"
import type { DeviceKeyring } from "../keyring-port.ts"
import type { SyncOperationAuthority } from "../operation-authority.ts"
import { disposeRecoveryKeys, publicKeyText } from "./derive.ts"
import { disposeMaterial, type EpochMaterial, sealWrap } from "./key-material.ts"
import { confirmationPositions, derivePhraseKeys, generateRecoveryPhrase } from "./phrase.ts"
import type { EnrollBridgeResult } from "./ports.ts"

/** A member's phrase enrollment: public chain facts, this member's own wrap, and the engine-drawn credential id (M3). */
export type PhraseEnrollBridgeRequest = {
  readonly account: string
  readonly credentialId: string
  readonly usedCredentialIds: ReadonlyArray<string>
  readonly custodyRoot: string
  readonly predecessor: string
  readonly epoch: number
  readonly deviceWrap: VerifiedWrap
  readonly expectedHistory: ReadonlyArray<readonly [number, string]>
}

const randomBytes = (length: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(length))

/**
 * Reference phrase enrollment (contract 6): show and confirm a fresh phrase first; only then derive, open this
 * member's current-epoch wrap, seal it to the new phrase key and countersign the one-entry wrap set. E, the
 * derived private keys and the epoch material are overwritten on every exit; only public values return.
 */
export const enrollPhraseInBridge = async (
  surface: PhraseSurface,
  keyring: DeviceKeyring,
  request: PhraseEnrollBridgeRequest,
  operation: SyncOperationAuthority,
  random: PhraseBridgeRandom = {},
): Promise<EnrollBridgeResult> => {
  if (request.usedCredentialIds.includes(request.credentialId)) return { ok: false, reason: "credential-reused" }
  const phrase = (random.phrase ?? generateRecoveryPhrase)()
  try {
    if (!(await showAndConfirm(surface, phrase, operation, random.positions ?? confirmationPositions)))
      return { ok: false, reason: "cancelled" }
    const expected = new Map(request.expectedHistory)
    const opened = await openWrap(keyring, request.deviceWrap, request.account, expected)
    if (!opened.ok) return { ok: false, reason: "device-wrap-refused" }
    const material: EpochMaterial = {
      epoch: request.epoch,
      current: opened.keys.current,
      history: [...opened.keys.history].map(([epoch, key]) => ({ epoch, origin: expected.get(epoch) ?? "", key })),
    }
    const nonce = (random.bytes ?? randomBytes)(32)
    const keys = await derivePhraseKeys(phrase, request.account, nonce)
    try {
      const publicKeys = publicKeyText(keys)
      const wrap = await sealWrap(
        { account: request.account, epoch: request.epoch, id: `recovery:${request.credentialId}` },
        publicKeys.sealing_public_key,
        material,
      )
      const digest = await wrapSetDigest([wrap])
      if (!digest.ok) return { ok: false, reason: "device-wrap-refused" }
      const countersign = await signFramed(
        "omo-sync/v1/recovery-countersign",
        {
          t: "omo-sync/v1/recovery-countersign",
          account: request.account,
          custody_root: request.custodyRoot,
          predecessor: request.predecessor,
          wraps_digest: digest.digest,
        },
        keys.signSeed,
      )
      const key: PhraseRecoveryKey = {
        credential_id: request.credentialId,
        rp_id: PHRASE_RECOVERY_RP_ID,
        enrollment_nonce: b64urlEncode(nonce),
        ...publicKeys,
        survivable: "phrase",
      }
      return { ok: true, key, countersign, wrap, wrapsDigest: digest.digest }
    } finally {
      disposeRecoveryKeys(keys)
      disposeMaterial(material)
    }
  } finally {
    phrase.dispose()
  }
}

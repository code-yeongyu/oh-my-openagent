import type { SyncAuthor, SyncRecordFields } from "./entry.ts"
import type { Authority } from "./fold.ts"
import {
  asciiBytes,
  b64urlDecode,
  b64urlEncode,
  concatBytes,
  type JsonValue,
  jcsBytes,
  sha256,
  sha256B64,
} from "./vendor/sync-format/jcs.ts"
import { verifyFramedBytes } from "./vendor/sync-format/keys.ts"
import { strictEd25519Key, strictEd25519Precheck } from "./strict-ed25519/strict-ed25519.ts"

export const decodeB64 = (value: JsonValue | undefined, length?: number): Uint8Array<ArrayBuffer> | null => {
  if (typeof value !== "string") return null
  try {
    const bytes = b64urlDecode(value)
    return length === undefined || bytes.length === length ? bytes : null
  } catch {
    return null
  }
}

/**
 * Ed25519 over `context || 0x00 || JCS(payload)`, framed exactly once by the vendored
 * `verifyFramedBytes`, with the key and signature lengths checked first and a weak key refused
 * (#10742), since WebCrypto on Bun verifies a forgery under one. Every JSON-payload signature in
 * this module verifies through here.
 */
export const verifyTagged = async (
  context: string,
  payload: JsonValue,
  publicKey: JsonValue | undefined,
  signature: JsonValue | undefined,
): Promise<boolean> => {
  const key = decodeB64(publicKey, 32)
  const sig = decodeB64(signature, 64)
  if (key === null || sig === null || !strictEd25519Precheck(key, sig).ok) return false
  return verifyFramedBytes(context, jcsBytes(payload), key, sig)
}

/** True only for a base64url key that decodes to 32 bytes and passes the strict check; malformed keys are false. */
export const isStrongKeyText = (publicKey: string): boolean => {
  const key = decodeB64(publicKey, 32)
  return key !== null && strictEd25519Key(key)
}

export const taggedHash = (context: string, payload: JsonValue): Promise<string> =>
  sha256B64(concatBytes([asciiBytes(context), Uint8Array.from([0]), jcsBytes(payload)]))

export const deviceIdOf = async (signingPublicKey: string): Promise<string | null> => {
  const key = decodeB64(signingPublicKey, 32)
  if (key === null) return null
  const prefix = concatBytes([asciiBytes("omo-sync/v1/device-id"), Uint8Array.from([0]), key])
  return b64urlEncode((await sha256(prefix)).subarray(0, 16))
}

export const recordPayload = (fields: SyncRecordFields): JsonValue => ({
  t: "omo-sync/v1/record",
  account: fields.account,
  base_seq: fields.base_seq,
  digest: fields.digest,
  epoch: fields.epoch,
  link: fields.link,
  ...(fields.keyring_link === null ? {} : { keyring_link: fields.keyring_link }),
})

/** The key an author signs with at a folded position: a member device, or an enrolled recovery key. */
export const authorSigningKey = (authority: Authority, author: SyncAuthor): string | null =>
  author.kind === "recovery"
    ? (authority.registry.get(author.credential_id)?.signing_public_key ?? null)
    : (authority.members.get(author.id)?.signing_public_key ?? null)

export const verifyRecordSig = (
  signingPublicKey: string,
  fields: SyncRecordFields & { readonly record_sig: string },
): Promise<boolean> =>
  verifyTagged("omo-sync/v1/record", recordPayload(fields), signingPublicKey, fields.record_sig)

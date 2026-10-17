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
 * `verifyFramedBytes`, with the key and signature lengths checked first. Every JSON-payload
 * signature in this module verifies through here.
 */
export const verifyTagged = async (
  context: string,
  payload: JsonValue,
  publicKey: JsonValue | undefined,
  signature: JsonValue | undefined,
): Promise<boolean> => {
  const key = decodeB64(publicKey, 32)
  const sig = decodeB64(signature, 64)
  if (key === null || sig === null) return false
  return verifyFramedBytes(context, jcsBytes(payload), key, sig)
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

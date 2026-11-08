import { Buffer } from "node:buffer"
import { createDecipheriv, createHmac, createPrivateKey, createPublicKey, diffieHellman } from "node:crypto"
import type { WrapBinding } from "./keyring-port"

/** Minimum sealed-box size: 32-byte enc + 16-byte tag, with an empty plaintext. */
const SEALED_BOX_OVERHEAD = 48

const HKDF_HASH_LENGTH = 32

function labeledExtract(suiteId: Buffer, label: string, ikm: Uint8Array, salt: Uint8Array): Buffer {
  // RFC 9180 §4: LabeledExtract = HKDF-Extract(salt, "HPKE-v1" || suite_id || label || ikm);
  // an empty salt means HashLen zero bytes (RFC 5869 §2.2).
  const key = salt.length === 0 ? Buffer.alloc(HKDF_HASH_LENGTH) : Buffer.from(salt)
  return createHmac("sha256", key).update(Buffer.concat([Buffer.from("HPKE-v1"), suiteId, Buffer.from(label), Buffer.from(ikm)])).digest()
}

function labeledExpand(suiteId: Buffer, label: string, prk: Buffer, info: Uint8Array, length: number): Buffer {
  // RFC 9180 §4: LabeledExpand = HKDF-Expand(prk, I2OSP(L,2) || "HPKE-v1" || suite_id || label || info).
  // Every expansion in this suite stays within one SHA-256 block, so T(1) suffices.
  if (length > HKDF_HASH_LENGTH) throw new Error("hpke expand length exceeds one SHA-256 block")
  const lengthBytes = Buffer.alloc(2)
  lengthBytes.writeUInt16BE(length)
  const t0 = Buffer.concat([lengthBytes, Buffer.from("HPKE-v1"), suiteId, Buffer.from(label), Buffer.from(info), Buffer.from([1])])
  return createHmac("sha256", prk).update(t0).digest().subarray(0, length)
}

const KEM_ID = Buffer.from([0, 0x20])
const KDF_ID = Buffer.from([0, 0x01])
const AEAD_ID = Buffer.from([0, 0x02])

function x25519PublicKeyFromRaw(raw: Uint8Array): ReturnType<typeof createPublicKey> {
  return createPublicKey({ key: { kty: "OKP", crv: "X25519", x: Buffer.from(raw).toString("base64url") }, format: "jwk" })
}

/**
 * Opens a sealed box with a raw X25519 private scalar and its public key,
 * following RFC 9180 §6.1 `SetupBaseR` + single-shot `Open`. `info` and `aad`
 * bind the box to its context; the DeviceKeyring passes the §8.1 wrap values.
 * Shared by every DeviceKeyring implementation so the construction above is
 * the only sealed-box code path in the tree.
 */
export function openHpkeSealedBox(
  sealingPrivateRaw: Uint8Array,
  sealingPublicRaw: Uint8Array,
  wrap: Uint8Array,
  info: Uint8Array = Buffer.alloc(0),
  aad: Uint8Array = Buffer.alloc(0),
): Uint8Array {
  if (wrap.length < SEALED_BOX_OVERHEAD) throw new Error("sealed box is too short")
  const enc = wrap.subarray(0, 32)
  const ciphertext = wrap.subarray(32)

  const privateKey = createPrivateKey({
    key: {
      kty: "OKP",
      crv: "X25519",
      d: Buffer.from(sealingPrivateRaw).toString("base64url"),
      x: Buffer.from(sealingPublicRaw).toString("base64url"),
    },
    format: "jwk",
  })
  // RFC 9180 §7.1.4: a low-order enc yields an all-zero shared secret, which must be refused.
  // The runtime may already throw on it; either way the caller sees the one refusal below.
  let dh: Buffer
  try {
    dh = diffieHellman({ privateKey, publicKey: x25519PublicKeyFromRaw(enc) })
  } catch {
    throw new Error("sealed box does not open: wrong recipient or corrupted wrap")
  }
  if (dh.every((byte) => byte === 0)) throw new Error("sealed box does not open: wrong recipient or corrupted wrap")

  const kem = Buffer.concat([Buffer.from("KEM"), KEM_ID])
  const suite = Buffer.concat([Buffer.from("HPKE"), KEM_ID, KDF_ID, AEAD_ID])
  const sharedSecret = labeledExpand(
    kem,
    "shared_secret",
    labeledExtract(kem, "eae_prk", dh, Buffer.alloc(0)),
    Buffer.concat([Buffer.from(enc), Buffer.from(sealingPublicRaw)]),
    32,
  )
  const keyScheduleContext = Buffer.concat([
    Buffer.from([0]),
    labeledExtract(suite, "psk_id_hash", Buffer.alloc(0), Buffer.alloc(0)),
    labeledExtract(suite, "info_hash", Buffer.from(info), Buffer.alloc(0)),
  ])
  const secret = labeledExtract(suite, "secret", Buffer.alloc(0), sharedSecret)
  const key = labeledExpand(suite, "key", secret, keyScheduleContext, 32)
  const nonce = labeledExpand(suite, "base_nonce", secret, keyScheduleContext, 12)

  const decipher = createDecipheriv("aes-256-gcm", key, nonce)
  if (aad.length > 0) decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16))
  try {
    return Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()])
  } catch {
    throw new Error("sealed box does not open: wrong recipient or corrupted wrap")
  }
}

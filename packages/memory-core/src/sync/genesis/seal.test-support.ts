import { createCipheriv, createHmac, createPrivateKey, createPublicKey, diffieHellman } from "node:crypto"
import { b64urlEncode, jcsBytes } from "../crypto/vendor/sync-format/jcs.ts"
import type { WrapAddress } from "../recovery/key-material.ts"

/** Test-only deterministic entropy; never accepted by a production bridge or RPC. */
export const bytes = (length: number, value: number): Uint8Array<ArrayBuffer> => new Uint8Array(length).fill(value)

export const privateDer = (kind: "ed25519" | "x25519", seed: Uint8Array): Buffer =>
  Buffer.concat([Buffer.from(kind === "ed25519" ? "302e020100300506032b657004220420" : "302e020100300506032b656e04220420", "hex"), seed])

/** Independent RFC 9180 sender, following keyring-port.test.ts, with test-owned encapsulation seeds. */
export const deterministicSeal = async (address: WrapAddress, recipient: string): Promise<string> => {
  const device = address.id.startsWith("device:")
  const nonce = bytes(12, device ? 11 : 12)
  const history = createCipheriv("aes-256-gcm", bytes(32, 7), nonce)
  history.setAAD(jcsBytes({ ...address, version: 1 }))
  const encryptedHistory = Buffer.concat([history.update(jcsBytes([])), history.final(), history.getAuthTag()])
  const plaintext = jcsBytes({
    version: 1,
    ...address,
    key_material: {
      version: 1,
      current_key: b64urlEncode(bytes(32, 7)),
      history: { nonce: b64urlEncode(nonce), ciphertext: b64urlEncode(encryptedHistory) },
    },
  })
  const ephemeral = createPrivateKey({ key: privateDer("x25519", bytes(32, device ? 21 : 22)), format: "der", type: "pkcs8" })
  const enc = Buffer.from(createPublicKey(ephemeral).export({ format: "jwk" }).x ?? "", "base64url")
  const pkR = Buffer.from(recipient, "base64url")
  const dh = diffieHellman({ privateKey: ephemeral, publicKey: createPublicKey({ key: { kty: "OKP", crv: "X25519", x: recipient }, format: "jwk" }) })
  const kem = Buffer.concat([Buffer.from("KEM"), Buffer.from([0, 32])])
  const suite = Buffer.concat([Buffer.from("HPKE"), Buffer.from([0, 32, 0, 1, 0, 2])])
  const info = Buffer.concat([Buffer.from("omo-sync/v1/wrap"), Buffer.from([0])])
  const extract = (suiteId: Buffer, label: string, value: Uint8Array, salt = Buffer.alloc(0)) =>
    createHmac("sha256", salt).update(Buffer.concat([Buffer.from("HPKE-v1"), suiteId, Buffer.from(label), value])).digest()
  const expand = (suiteId: Buffer, label: string, key: Buffer, context: Uint8Array, length: number) => {
    const size = Buffer.alloc(2)
    size.writeUInt16BE(length)
    return createHmac("sha256", key).update(Buffer.concat([size, Buffer.from("HPKE-v1"), suiteId, Buffer.from(label), context, Buffer.from([1])])).digest().subarray(0, length)
  }
  const shared = expand(kem, "shared_secret", extract(kem, "eae_prk", dh), Buffer.concat([enc, pkR]), 32)
  const context = Buffer.concat([Buffer.from([0]), extract(suite, "psk_id_hash", Buffer.alloc(0)), extract(suite, "info_hash", info)])
  const schedule = extract(suite, "secret", Buffer.alloc(0), shared)
  const cipher = createCipheriv("aes-256-gcm", expand(suite, "key", schedule, context, 32), expand(suite, "base_nonce", schedule, context, 12))
  cipher.setAAD(jcsBytes(address))
  return b64urlEncode(Buffer.concat([enc, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]))
}

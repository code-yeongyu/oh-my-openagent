import { createCipheriv, createHmac, createPublicKey, diffieHellman, generateKeyPairSync } from "node:crypto"
import type { WrapBinding } from "../../keyring-port.ts"
import { b64urlEncode, type JsonValue, jcsBytes } from "../vendor/sync-format/jcs.ts"

// A test-side section 8.1 sender (RFC 9180 base mode, info "omo-sync/v1/wrap\0", AAD = JCS{account,
// epoch, id}): anyone holding a recipient's public sealing key can seal to it, the server included.
export const sealToPort = (recipient: string, plaintext: Uint8Array, binding: WrapBinding): Uint8Array => {
  const ephemeral = generateKeyPairSync("x25519")
  const enc = Buffer.from(ephemeral.publicKey.export({ format: "jwk" }).x ?? "", "base64url")
  const dh = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: createPublicKey({ key: { kty: "OKP", crv: "X25519", x: recipient }, format: "jwk" }) })
  const kem = Buffer.concat([Buffer.from("KEM"), Buffer.from([0, 32])])
  const suite = Buffer.concat([Buffer.from("HPKE"), Buffer.from([0, 32, 0, 1, 0, 2])])
  const info = Buffer.concat([Buffer.from("omo-sync/v1/wrap"), Buffer.from([0])])
  const extract = (id: Buffer, label: string, value: Uint8Array, salt = Buffer.alloc(0)) =>
    createHmac("sha256", salt).update(Buffer.concat([Buffer.from("HPKE-v1"), id, Buffer.from(label), value])).digest()
  const expand = (id: Buffer, label: string, key: Buffer, data: Uint8Array, length: number) =>
    createHmac("sha256", key).update(Buffer.concat([Buffer.from([0, length]), Buffer.from("HPKE-v1"), id, Buffer.from(label), data])).update(Buffer.from([1])).digest().subarray(0, length)
  const secret = expand(kem, "shared_secret", extract(kem, "eae_prk", dh), Buffer.concat([enc, Buffer.from(recipient, "base64url")]), 32)
  const context = Buffer.concat([Buffer.from([0]), extract(suite, "psk_id_hash", Buffer.alloc(0)), extract(suite, "info_hash", info)])
  const schedule = extract(suite, "secret", Buffer.alloc(0), secret)
  const cipher = createCipheriv("aes-256-gcm", expand(suite, "key", schedule, context, 32), expand(suite, "base_nonce", schedule, context, 12))
  cipher.setAAD(jcsBytes({ account: binding.account, epoch: binding.epoch, id: binding.id }))
  return Buffer.concat([enc, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
}

export const keyMaterial = async (account: string, epoch: number, id: string, current: Uint8Array = crypto.getRandomValues(new Uint8Array(32))) => {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey("raw", new Uint8Array(current), "AES-GCM", false, ["encrypt"])
  const additionalData = jcsBytes({ account, epoch, id, version: 1 })
  const empty: ReadonlyArray<JsonValue> = []
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData }, key, jcsBytes(empty)))
  return { version: 1, current_key: b64urlEncode(current), history: { nonce: b64urlEncode(nonce), ciphertext: b64urlEncode(ciphertext) } }
}

/** A well-formed epoch-1 wrap envelope for `id`, sealed to `sealingPublicKey`; `current` is the epoch key the sealer chose. */
export const sealedEpochWrap = async (sealingPublicKey: string, account: string, id: string, current?: Uint8Array): Promise<string> => {
  const envelope = { version: 1, account, epoch: 1, id, key_material: await keyMaterial(account, 1, id, current) }
  return b64urlEncode(sealToPort(sealingPublicKey, jcsBytes(envelope), { account, epoch: 1, id }))
}

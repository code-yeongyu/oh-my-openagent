import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

export type EncryptedEnvelope = {
  readonly key_id: string
  readonly alg: "aes-256-gcm"
  readonly iv: string
  readonly auth_tag: string
  readonly ciphertext: string
}

const ALG = "aes-256-gcm" as const
const KEY_BYTES = 32
const IV_BYTES = 12

export function encryptEnvelope(
  plaintext: string,
  masterKey: Buffer,
  keyId: string,
): EncryptedEnvelope {
  assertMasterKey(masterKey)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALG, masterKey, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  return {
    key_id: keyId,
    alg: ALG,
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  }
}

export function decryptEnvelope(envelope: EncryptedEnvelope, masterKey: Buffer): string {
  assertMasterKey(masterKey)
  if (envelope.alg !== ALG) {
    throw new Error(`envelope_decrypt_failed: unsupported alg ${envelope.alg}`)
  }
  try {
    const decipher = createDecipheriv(ALG, masterKey, Buffer.from(envelope.iv, "base64"))
    decipher.setAuthTag(Buffer.from(envelope.auth_tag, "base64"))
    const out = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ])
    return out.toString("utf8")
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown"
    throw new Error(`envelope_decrypt_failed: ${reason}`)
  }
}

export function serializeEnvelope(env: EncryptedEnvelope): string {
  return JSON.stringify(env)
}

export function parseEnvelope(json: string): EncryptedEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    const reason = err instanceof Error ? err.message : "invalid json"
    throw new Error(`envelope_parse_failed: ${reason}`)
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("envelope_parse_failed: expected object")
  }
  const record = parsed as Record<string, unknown>
  for (const field of ["key_id", "alg", "iv", "auth_tag", "ciphertext"] as const) {
    if (typeof record[field] !== "string") {
      throw new Error(`envelope_parse_failed: missing or invalid field ${field}`)
    }
  }
  if (record.alg !== ALG) {
    throw new Error(`envelope_parse_failed: unsupported alg ${String(record.alg)}`)
  }
  return {
    key_id: record.key_id as string,
    alg: ALG,
    iv: record.iv as string,
    auth_tag: record.auth_tag as string,
    ciphertext: record.ciphertext as string,
  }
}

function assertMasterKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    const len = Buffer.isBuffer(key) ? key.length : -1
    throw new Error(`envelope_invalid_master_key: expected ${KEY_BYTES} bytes, got ${len}`)
  }
}

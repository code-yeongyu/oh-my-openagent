import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { log } from "../../../shared/logger"
import { getDefaultDbPath } from "../paths"

export type EncryptedPayload = {
  ciphertext: string
  iv: string
  authTag: string
}

let warnedAboutDefaultKey = false

export function encryptAuthConfig(plaintext: string, masterKey: Buffer): EncryptedPayload {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", normalizeMasterKey(masterKey), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  }
}

export function decryptAuthConfig(payload: EncryptedPayload, masterKey: Buffer): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    normalizeMasterKey(masterKey),
    Buffer.from(payload.iv, "base64"),
  )
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"))
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8")
}

export function getCredentialMasterKey(): Buffer {
  const envKey = process.env.IDM_PROBE_LAB_MASTER_KEY
  if (envKey) return parseEnvKey(envKey)
  if (!warnedAboutDefaultKey) {
    log("[probe-lab] WARNING: IDM_PROBE_LAB_MASTER_KEY unset; deriving development key from DB path. Set a 32-byte hex key in production.")
    warnedAboutDefaultKey = true
  }
  return createHash("sha256").update(getDefaultDbPath()).digest()
}

export function parseEncryptedPayload(text: string): EncryptedPayload | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!isEncryptedPayload(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function parseEnvKey(hex: string): Buffer {
  const key = Buffer.from(hex, "hex")
  if (key.length !== 32 || hex.length !== 64) {
    throw new Error("IDM_PROBE_LAB_MASTER_KEY must be a 32-byte hex string")
  }
  return key
}

function normalizeMasterKey(key: Buffer): Buffer {
  if (key.length !== 32) throw new Error("probe-lab credential master key must be 32 bytes")
  return key
}

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (value == null || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return typeof record.ciphertext === "string"
    && typeof record.iv === "string"
    && typeof record.authTag === "string"
}

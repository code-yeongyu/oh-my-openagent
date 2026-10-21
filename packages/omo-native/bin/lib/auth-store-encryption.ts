/**
 * AES-GCM at-rest encryption for `<agentDir>/auth.json`.
 *
 * Three modes:
 * - `plain`     — write the entries as JSON, unchanged from the pre-PR behaviour.
 * - `passphrase` — scrypt(passphrase, salt) into a 32-byte AES-256-GCM key.
 *   The passphrase lives in process memory; it is never written to disk.
 * - `ssh-key`   — derive the key from the user's own ssh key (default
 *   `~/.ssh/id_ed25519`; override via the `sshKeyPath` option). No second
 *   secret is required.
 *
 * An envelope is a JSON object whose on-disk plaintext NEVER contains the
 * stored credentials. Mode, version, derivation parameters, nonce and
 * auth-tag travel with the file so a future schema change can be detected.
 */

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, scryptSync } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type AuthAtRestMode = "plain" | "passphrase" | "ssh-key"

export const AUTH_AT_REST_VERSION = 1
const SALT_BYTES = 16
const NONCE_BYTES = 12
const KEY_BYTES = 32
const SCRYPT_N = 1 << 15
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_MAXMEM = 64 * 1024 * 1024

export interface EncryptedAuthEnvelope {
  readonly version: number
  readonly mode: AuthAtRestMode
  /** For `passphrase`: scrypt salt. For `ssh-key`: empty string. */
  readonly salt: string
  /** Per-file random nonce, base64. */
  readonly nonce: string
  /** AES-256-GCM auth tag, base64. */
  readonly tag: string
  /** AES-256-GCM ciphertext (the JSON.stringify of the entries), base64. */
  readonly ciphertext: string
  /** Public ssh-key fingerprint when derived from ssh, hex; empty otherwise. */
  readonly sshFingerprint?: string
}

export interface EncryptOptions {
  readonly passphrase?: string
  readonly sshKeyPath?: string
}

export interface DecryptOptions {
  readonly passphrase?: string
  readonly sshKeyPath?: string
  /** Optional passphrase to unlock a passphrase-protected ssh key. */
  readonly sshPassphrase?: string
}

function derivePassphraseKey(passphrase: string, salt: Buffer): Buffer {
  // scrypt is the canonical RFC 7914 PBKDF for "memorable secret" use cases. The parameter set
  // is intentionally conservative for an interactive `omo` invocation: about 64 MiB of memory,
  // 15-bit N, r=8, p=1. AES-256 wants 32 bytes; crypto.scryptSync has a cap on maxmem and emits
  // a RangeError past it, which the caller catches.
  return scryptSync(Buffer.from(passphrase, "utf8"), salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })
}

function sshPublicFingerprint(keyPath: string): { fingerprint: string; material: Buffer } {
  // Read the file on disk byte-for-byte. The derivation does not depend on the key type:
  // any user-owned ssh-key file the user chooses is sufficient, since the goal is to bind the
  // ciphertext to "this user has this file on disk" and never to reproduce the actual ssh
  // secret. The public-key fingerprint is recorded so a wrong-key error can name which file
  // was expected.
  const material = readFileSync(keyPath)
  const fingerprint = createHash("sha256").update(material).digest("hex")
  return { fingerprint, material }
}

function deriveSshKey(material: Buffer, info: string): Buffer {
  // HKDF over the key material, treating it as IKM. Empty salt is the documented HKDF default
  // when the application already has a high-entropy input; the per-file nonce already supplies
  // the randomisation a derived key needs to encrypt distinct files. Output length is 32 bytes
  // for AES-256.
  return Buffer.from(hkdfSync("sha256", material, Buffer.alloc(0), info, KEY_BYTES))
}

export function encryptAuthStore(entries: Record<string, unknown>, options: EncryptOptions): EncryptedAuthEnvelope {
  if (options.passphrase !== undefined) {
    const salt = randomBytes(SALT_BYTES)
    const key = derivePassphraseKey(options.passphrase, salt)
    const nonce = randomBytes(NONCE_BYTES)
    const cipher = createCipheriv("aes-256-gcm", key, nonce)
    const plaintext = Buffer.from(JSON.stringify(entries), "utf8")
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()
    return {
      version: AUTH_AT_REST_VERSION,
      mode: "passphrase",
      salt: salt.toString("base64"),
      nonce: nonce.toString("base64"),
      tag: tag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    }
  }
  if (options.sshKeyPath !== undefined) {
    const { fingerprint, material } = sshPublicFingerprint(options.sshKeyPath)
    const key = deriveSshKey(material, "omo-auth-at-rest:auth.json")
    const nonce = randomBytes(NONCE_BYTES)
    const cipher = createCipheriv("aes-256-gcm", key, nonce)
    const plaintext = Buffer.from(JSON.stringify(entries), "utf8")
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()
    return {
      version: AUTH_AT_REST_VERSION,
      mode: "ssh-key",
      salt: "",
      nonce: nonce.toString("base64"),
      tag: tag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      sshFingerprint: fingerprint,
    }
  }
  throw new Error("auth-at-rest: encrypt requires passphrase or sshKeyPath")
}

export class AuthDecryptionError extends Error {
  readonly code = "AUTH_DECRYPTION_FAILED"
  readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = "AuthDecryptionError"
    this.cause = cause
  }
}

export function decryptAuthStore(envelope: EncryptedAuthEnvelope, options: DecryptOptions): Record<string, unknown> {
  if (envelope.mode === "passphrase") {
    if (typeof options.passphrase !== "string") {
      throw new AuthDecryptionError("auth-at-rest: passphrase required to read encrypted auth.json")
    }
    const salt = Buffer.from(envelope.salt, "base64")
    const key = derivePassphraseKey(options.passphrase, salt)
    const nonce = Buffer.from(envelope.nonce, "base64")
    const tag = Buffer.from(envelope.tag, "base64")
    return decryptWithKey(key, nonce, tag, envelope.ciphertext, "passphrase")
  }
  if (envelope.mode === "ssh-key") {
    if (typeof options.sshKeyPath !== "string") {
      throw new AuthDecryptionError("auth-at-rest: sshKeyPath required to read encrypted auth.json")
    }
    const { material } = sshPublicFingerprint(options.sshKeyPath)
    const key = deriveSshKey(material, "omo-auth-at-rest:auth.json")
    const nonce = Buffer.from(envelope.nonce, "base64")
    const tag = Buffer.from(envelope.tag, "base64")
    return decryptWithKey(key, nonce, tag, envelope.ciphertext, "ssh-key")
  }
  throw new AuthDecryptionError(`auth-at-rest: unknown envelope mode ${String(envelope.mode)}`)
}

function decryptWithKey(
  key: Buffer,
  nonce: Buffer,
  tag: Buffer,
  ciphertextBase64: string,
  mode: AuthAtRestMode,
): Record<string, unknown> {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: tag.length })
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextBase64, "base64")),
      decipher.final(),
    ])
    const parsed = JSON.parse(plaintext.toString("utf8"))
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AuthDecryptionError(`auth-at-rest: ${mode} envelope did not decode to an object`)
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof AuthDecryptionError) throw error
    throw new AuthDecryptionError(`auth-at-rest: ${mode} decryption failed (wrong key or tampered file)`, error)
  }
}

export function isEncryptedEnvelope(value: unknown): value is EncryptedAuthEnvelope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.version === "number" &&
    (candidate.mode === "passphrase" || candidate.mode === "ssh-key") &&
    typeof candidate.salt === "string" &&
    typeof candidate.nonce === "string" &&
    typeof candidate.tag === "string" &&
    typeof candidate.ciphertext === "string"
  )
}

export interface ResolvedAuthAtRestMode {
  readonly mode: AuthAtRestMode
  readonly shouldPrompt: boolean
  readonly recommended?: AuthAtRestMode
}

const STATE_DIR_NAME = ".omo"
const STATE_AUTH_MODE_FILENAME = "auth-at-rest-mode.json"

function readStickyMode(home: string): AuthAtRestMode | undefined {
  const path = join(home, STATE_DIR_NAME, STATE_AUTH_MODE_FILENAME)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    if (parsed === null || typeof parsed !== "object") return undefined
    const mode = (parsed as Record<string, unknown>).auth_at_rest
    if (mode === "plain" || mode === "passphrase" || mode === "ssh-key") return mode
  } catch {
    // A hand-edited state file must never break the launch; fall through to the configured mode.
  }
  return undefined
}

/**
 * The `omo doctor` lines that name the in-effect auth-at-rest mode. A `plain` mode line is only
 * emitted when an `auth.json` actually holds entries (the deprecation hint is for users who have
 * keys; an empty agent dir is not worth telling). `passphrase` and `ssh-key` are always named so
 * a user can confirm the encryption without running `setup`.
 */
export function authAtRestDoctorLines({ agentDir, env }: { agentDir: string; env?: NodeJS.ProcessEnv }): string[] {
  const home = env?.HOME || env?.USERPROFILE || ""
  try {
    const authPath = join(agentDir, "auth.json")
    if (!existsSync(authPath)) return []
    const raw = readFileSync(authPath, "utf8")
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return [`WARN auth-at-rest: ${authPath} is not parseable; omo cannot tell the mode`]
    }
    if (!isEncryptedEnvelope(parsed)) return []
    if (parsed.mode === "passphrase") {
      return [`INFO auth-at-rest: passphrase (scrypt + AES-256-GCM)`]
    }
    if (parsed.mode === "ssh-key") {
      const fingerprint = typeof parsed.sshFingerprint === "string" ? parsed.sshFingerprint.slice(0, 16) : ""
      return [`INFO auth-at-rest: ssh-key (AES-256-GCM, fingerprint ${fingerprint})`]
    }
    return []
  } catch (error) {
    return [`WARN auth-at-rest: ${error instanceof Error ? error.message : String(error)}`]
  }
}

const DEFAULT_SSH_KEY_CANDIDATES = [
  join(".ssh", "id_ed25519"),
  join(".ssh", "id_rsa"),
  join(".ssh", "id_ecdsa"),
]

function hasSshKey(home: string): boolean {
  for (const relative of DEFAULT_SSH_KEY_CANDIDATES) {
    if (existsSync(join(home, relative))) return true
  }
  return false
}

export interface ResolveAuthAtRestModeOptions {
  /** Resolved user home directory. */
  readonly home: string
  /** Whether the launcher is interactive (TTY). */
  readonly interactive: boolean
  /** Explicit mode read from `security.auth_at_rest` in omo.json; undefined when absent. */
  readonly configured?: AuthAtRestMode
  /** Number of entries already in auth.json on disk; controls the first-run prompt gate. */
  readonly existingEntries?: number
}

export function resolveAuthAtRestMode(options: ResolveAuthAtRestModeOptions): ResolvedAuthAtRestMode {
  const sticky = readStickyMode(options.home)
  const explicit = options.configured ?? sticky
  if (explicit !== undefined) {
    return { mode: explicit, shouldPrompt: false }
  }
  // Default-stays-plain is the contract for PR-E (security roadmap 2026q4).
  // The first time a user opens omo with credentials already on disk, give them the chance to
  // upgrade to a non-plain mode. SSH-key is recommended when a key is present; passphrase otherwise.
  const hasExisting = (options.existingEntries ?? 0) > 0
  if (options.interactive && hasExisting) {
    const recommended: AuthAtRestMode = hasSshKey(options.home) ? "ssh-key" : "passphrase"
    return { mode: "plain", shouldPrompt: true, recommended }
  }
  return { mode: "plain", shouldPrompt: false }
}

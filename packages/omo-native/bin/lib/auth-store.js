/**
 * Read and write the engine's `<agentDir>/auth.json`: every setup stage that imports a key goes
 * through here, so they all escape, back up and write it the same way.
 *
 * On disk the file is either a plain JSON object (the legacy `plain` mode, currently the default
 * and deprecated) or an `AuthAtRestEnvelope` (`passphrase` / `ssh-key` modes from PR-E). The mode
 * is read on every read; passing an explicit `options` makes the read know what it must decrypt.
 */

import { chmodSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import {
  AuthDecryptionError,
  decryptAuthStore,
  encryptAuthStore,
  isEncryptedEnvelope,
} from "./auth-store-encryption.ts"

// opencode keeps a pasted key verbatim and never interprets it, but the engine resolves every stored
// key as a config value: a leading `!` runs a shell command and `$NAME` / `${NAME}` interpolate the
// environment. `$$` and `$!` are the engine's literal escapes, so the engine reads back the exact
// bytes opencode held.
export function literalConfigValue(value) {
  return value.replace(/[$!]/g, "$$$&")
}

/**
 * `options`:
 * - `mode`: the encryption mode in effect today. `undefined` (legacy callers) defaults to
 *   `"plain"` so the existing public callers see no change.
 * - `passphrase`: required for `passphrase` mode when reading.
 * - `sshKeyPath`: required for `ssh-key` mode when reading.
 *
 * Returns `{ entries, bytes, error }`; `entries` is `undefined` and `error` is set when a
 * passphrase-encrypted or ssh-key-encrypted file could not be decrypted (caller should surface
 * the failure and refuse to write). A plaintext file is always read successfully so a legacy
 * `auth.json` is usable until the next `writeAuthStore` rewrites it encrypted under the new mode.
 */
export function readAuthStore(path, options = {}) {
  if (!existsSync(path)) return { entries: {}, bytes: undefined }
  const bytes = readFileSync(path, "utf8")
  try {
    const parsed = JSON.parse(bytes)
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected object")
    if (isEncryptedEnvelope(parsed)) {
      const mode = options.mode ?? "plain"
      if (mode === "plain") {
        return { malformed: true, bytes, error: "auth.json is encrypted but security.auth_at_rest is \"plain\"" }
      }
      try {
        const entries = decryptAuthStore(parsed, {
          passphrase: options.passphrase,
          sshKeyPath: options.sshKeyPath,
        })
        return { entries, bytes }
      } catch (error) {
        if (error instanceof AuthDecryptionError) {
          return { entries: undefined, bytes, error: error.message }
        }
        return { malformed: true, bytes, error: error.message }
      }
    }
    return { entries: parsed, bytes }
  } catch {
    return { malformed: true, bytes }
  }
}

export function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "")
}

// The credential and custom-provider stages of one run can both rewrite auth.json within the same
// millisecond. The first backup holds the older bytes, so a later one never replaces it.
function backup(path) {
  try {
    copyFileSync(path, `${path}.bak-${timestamp()}`, constants.COPYFILE_EXCL)
  } catch (error) {
    if (error.code !== "EEXIST") throw error
  }
}

/**
 * `options`:
 * - `mode`: `"plain" | "passphrase" | "ssh-key"`. Defaults to `"plain"` for backward compat.
 * - `passphrase`: required when `mode === "passphrase"`.
 * - `sshKeyPath`: required when `mode === "ssh-key"`.
 *
 * Empty `additions` are still written: an encrypted placeholder records the user's mode choice
 * on disk and lets a later read return `{ entries: {} }` rather than `undefined`.
 */
export function writeAuthStore(path, current, additions, options = {}) {
  const mode = options.mode ?? "plain"
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (current.bytes !== undefined) backup(path)
  const next = { ...(current.entries ?? {}) }
  for (const item of additions) next[item.provider] = { type: "api_key", key: item.key }

  let payload
  if (mode === "plain") {
    payload = JSON.stringify(next, null, 2)
  } else if (mode === "passphrase") {
    if (typeof options.passphrase !== "string") {
      throw new Error("auth-at-rest: passphrase required to write encrypted auth.json")
    }
    payload = JSON.stringify(encryptAuthStore(next, { passphrase: options.passphrase }))
  } else if (mode === "ssh-key") {
    if (typeof options.sshKeyPath !== "string") {
      throw new Error("auth-at-rest: sshKeyPath required to write encrypted auth.json")
    }
    payload = JSON.stringify(encryptAuthStore(next, { sshKeyPath: options.sshKeyPath }))
  } else {
    throw new Error(`auth-at-rest: unknown mode ${mode}`)
  }

  const temporary = `${path}.tmp-${process.pid}`
  try {
    writeFileSync(temporary, payload, { encoding: "utf8", mode: 0o600 })
    chmodSync(temporary, 0o600)
    renameSync(temporary, path)
    chmodSync(path, 0o600)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

/**
 * Where omo keeps the bytes of a secret it moved out of a config file.
 *
 * The store lives in the omo home, not in the agent dir: the agent dir can be relocated with
 * `OMO_CODING_AGENT_DIR` while the references that point at these files are absolute, so the
 * bytes must not move with it. `adoptLegacyFlatState` copies a fixed filename allowlist out
 * of `~/.omo/`, so the store is never carried along by the legacy-layout migration either.
 *
 * The directory is 0700 and every file in it is 0600. A store that is a symlink, that is not
 * a directory, or that others can write to is refused: a secret must never be written through
 * a link, and a directory another account can write to is not a safe place to keep one.
 */

import { createHash } from "node:crypto"
import { chmodSync, lstatSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const STORE_DIRNAME = "secrets"
const FILE_MODE = 0o600
const DIR_MODE = 0o700

/** The directory omo keeps moved-out secrets in. */
export function secretStoreDir(home) {
  return join(home, ".omo", STORE_DIRNAME)
}

/**
 * The name a secret is stored under.
 *
 * It comes from the FIELD PATH, never from the secret's content: a name derived from the
 * content would tell anyone who could list the directory whether a guessed secret was the
 * right one. The readable part is there so a person can tell the files apart, and the hash
 * keeps two different fields apart even when their readable parts collide.
 */
export function secretFileName(keyPath) {
  const digest = createHash("sha256").update(keyPath).digest("hex").slice(0, 16)
  const slug = keyPath.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 48)
  return `${slug}-${digest}.secret`
}

/**
 * Make sure the store is a directory no one else can read or write.
 *
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function ensureSecretStore(dir) {
  let stats
  try {
    stats = lstatSync(dir)
  } catch (error) {
    if (error.code !== "ENOENT") return { ok: false, reason: `the secret store at ${dir} could not be read` }
    try {
      mkdirSync(dirname(dir), { recursive: true })
      mkdirSync(dir, { mode: DIR_MODE })
      chmodSync(dir, DIR_MODE)
    } catch {
      return { ok: false, reason: `the secret store at ${dir} could not be created` }
    }
    return { ok: true }
  }
  if (stats.isSymbolicLink()) return { ok: false, reason: `the secret store at ${dir} is a symlink` }
  if (!stats.isDirectory()) return { ok: false, reason: `the secret store at ${dir} is not a directory` }
  // Anything another account can read can enumerate the secret file names, and anything it can
  // write can replace one. Only 0700 is a safe store.
  if ((stats.mode & 0o077) !== 0) return { ok: false, reason: `the secret store at ${dir} is readable or writable by others` }
  return { ok: true }
}

/**
 * Write a secret into the store.
 *
 * The file holds the bytes exactly as the value spells them, with nothing added: the engine
 * reads the file and uses what is in it. There is deliberately no backup copy. The config
 * backups are what multiply a secret across the disk, and a second copy of the bytes would do
 * the same thing here.
 *
 * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
 */
export function writeSecret(dir, keyPath, value) {
  const name = secretFileName(keyPath)
  const path = join(dir, name)
  const store = ensureSecretStore(dir)
  if (!store.ok) return store
  const temporary = `${path}.tmp-${process.pid}`
  try {
    writeFileSync(temporary, value, { encoding: "utf8", mode: FILE_MODE, flag: "wx" })
    chmodSync(temporary, FILE_MODE)
    renameSync(temporary, path)
  } catch {
    try {
      unlinkSync(temporary)
    } catch {
      // the temporary file was never created
    }
    return { ok: false, reason: `the secret could not be written to ${path}` }
  }
  return { ok: true, path }
}

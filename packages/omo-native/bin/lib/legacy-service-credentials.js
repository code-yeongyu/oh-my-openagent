import { lstatSync, readFileSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// An intermediate sign-in build left device private keys and refresh material in a plaintext
// `~/.omo/credentials.json`, sometimes world-readable (#10697). Credentials now live only in the OS
// keystore, so nothing reads this file; remove it on launch. Only the exact legacy shape is removed:
// a regular file (never a symlink or FIFO) whose JSON object carries both private keys.
const MAX_LEGACY_BYTES = 64 * 1024

export function removeLegacyServiceCredentials(home = process.env.HOME || process.env.USERPROFILE || homedir()) {
  const path = join(home, ".omo", "credentials.json")
  let stats
  try {
    stats = lstatSync(path)
  } catch {
    return false
  }
  if (!stats.isFile() || stats.size > MAX_LEGACY_BYTES) return false

  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return false
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return false
  if (!("signingPrivateKey" in parsed) || !("sealingPrivateKey" in parsed)) return false

  try {
    unlinkSync(path)
  } catch {
    return false
  }
  return true
}

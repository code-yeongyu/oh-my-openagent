import { spawnSync } from "node:child_process"
import { existsSync, lstatSync } from "node:fs"
import { userInfo } from "node:os"
import { dirname, join } from "node:path"

// The keychain helper's designated requirement; test/keychain-helper-doctor.test.ts pins it equal to the one the
// helper is built for (packages/omo-native/keychain-helper/build.ts).
export const KEYCHAIN_HELPER_REQUIREMENT =
  'identifier "com.mengmota.omo-keychain-helper" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] ' +
  'and certificate leaf[field.1.2.840.113635.100.6.1.13] and certificate leaf[subject.OU] = "523JNR86LZ"'

const verifyWithCodesign = (path) =>
  spawnSync("/usr/bin/codesign", ["--verify", "--strict", `-R=${KEYCHAIN_HELPER_REQUIREMENT}`, path], {
    stdio: "ignore",
  }).status === 0

/**
 * The one place a missing or damaged keychain helper is reported (#11262 addendum Q1/row 9): normal output stays silent
 * and sign-in takes the previous path, so this is a warning, never a failure. macOS only.
 */
export function keychainHelperDoctorLines({
  packageRoot,
  helperRelPath = "bin/darwin/omo-keychain",
  platform = process.platform,
  exists = existsSync,
  verify = verifyWithCodesign,
  home = userInfo().homedir,
  stat = statOrNull,
}) {
  if (platform !== "darwin") return []
  return [
    helperLine(join(packageRoot, helperRelPath), helperRelPath, exists, verify),
    ...credentialStoreLines(home, stat),
  ]
}

function helperLine(helper, helperRelPath, exists, verify) {
  if (!exists(helper))
    return `WARN keychain helper: missing ${helperRelPath}; macOS sign-in uses the previous keychain path and may ask for access again. Reinstall omo.`
  if (!verify(helper))
    return `WARN keychain helper: ${helperRelPath} failed its signature check and is never run; reinstall omo.`
  return `PASS keychain helper: ${helperRelPath} (signed)`
}

function statOrNull(path) {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

const STORE_DIRECTORY = join("Library", "Application Support", "OmO", "credential-keychain")

// The same checks the keychain helper makes before it uses OmO's own keychain (#13116), so doctor names the refusal
// the helper would answer. Nothing here repairs the store; without one, doctor prints nothing (the login keychain).
function storeProblem(root, stat) {
  const uid = process.getuid?.()
  const owned = (info) => info !== null && !info.isSymbolicLink() && info.uid === uid
  const parent = stat(dirname(root))
  if (!owned(parent) || !parent.isDirectory() || (parent.mode & 0o022) !== 0) return "parent"
  const directory = stat(root)
  if (!owned(directory) || !directory.isDirectory() || (directory.mode & 0o7777) !== 0o700) return "folder"
  const keychain = stat(join(root, "omo-credentials.keychain-db"))
  if (!owned(keychain) || !keychain.isFile() || (keychain.mode & 0o7777) !== 0o600) return "keychain"
  const key = stat(join(root, "unlock-key"))
  if (!owned(key) || !key.isFile() || (key.mode & 0o7777) !== 0o600 || key.size !== 64) return "key"
  return null
}

function credentialStoreLines(home, stat) {
  const root = join(home, STORE_DIRECTORY)
  if (stat(root) === null) return []
  const problem = storeProblem(root, stat)
  if (problem !== null)
    return [
      `WARN credential store: OmO's own keychain at ${root} is refused (${problem}); it must be a private folder you own (0700) holding 0600 files. omo never repairs it or falls back to the login keychain.`,
    ]
  if (stat(join(root, "active")) === null)
    return [
      `WARN credential store: OmO's own keychain at ${root} is set up but not active; finish with omo account store enable, or remove it with omo account store disable.`,
    ]
  return [`PASS credential store: OmO's own keychain (${root})`]
}
